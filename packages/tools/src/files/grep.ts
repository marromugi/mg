import { execFile, type ExecFileException } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Tool } from "@mg/core";
import { z } from "zod";
import { FileToolError } from "./errors.js";
import { resolveExistingPath } from "./root.js";

export type GrepToolOptions = {
  root: string;
  rgPath?: string;
  timeoutMs?: number;
  maxResults?: number;
  maxLineChars?: number;
  maxOutputBytes?: number;
};

const grepInput = z.object({
  pattern: z
    .string()
    .min(1)
    .describe("Regular expression (ripgrep syntax)"),
  path: z
    .string()
    .optional()
    .describe(
      "File or directory to search, relative to the root; default is the root",
    ),
  glob: z
    .string()
    .optional()
    .describe("Only search files matching this glob, e.g. *.ts"),
  ignoreCase: z.boolean().optional(),
});

type RgMatch = {
  type: "match";
  data: {
    path: { text?: string; bytes?: string };
    line_number: number;
    lines: { text?: string; bytes?: string };
    submatches: { start: number; end: number }[];
  };
};

const isRgMatch = (value: unknown): value is RgMatch => {
  if (typeof value !== "object" || value === null) return false;
  return (value as { type?: unknown }).type === "match";
};

type RunResult = {
  stdout: string;
  stderr: string;
  error: ExecFileException | null;
};

const run = (
  rgPath: string,
  args: string[],
  options: {
    cwd: string;
    timeout: number;
    maxBuffer: number;
    signal?: AbortSignal;
  },
): Promise<RunResult> =>
  new Promise((resolve) => {
    execFile(rgPath, args, options, (error, stdout, stderr) => {
      resolve({ stdout, stderr, error });
    });
  });

const isAbortError = (error: unknown): boolean =>
  error instanceof Error && error.name === "AbortError";

export const columnOf = (lineText: string, byteStart: number): number =>
  Array.from(
    Buffer.from(lineText, "utf8")
      .subarray(0, byteStart)
      .toString("utf8"),
  ).length + 1;

const trimTrailingNewline = (text: string): string =>
  text.endsWith("\r\n")
    ? text.slice(0, -2)
    : text.endsWith("\n")
      ? text.slice(0, -1)
      : text;

const truncateLine = (text: string, maxLineChars: number): string => {
  const chars = Array.from(text);
  if (chars.length <= maxLineChars) return text;
  return `${chars.slice(0, maxLineChars).join("")}…`;
};

const dropTrailingPartialLine = (text: string): string => {
  const lastNewline = text.lastIndexOf("\n");
  return lastNewline === -1 ? "" : text.slice(0, lastNewline);
};

type ParsedMatches = {
  lines: string[];
  truncated: boolean;
  invalidUtf8: number;
  binary: number;
};

const formatMatches = (
  stdout: string,
  rootReal: string,
  maxResults: number,
  maxLineChars: number,
): ParsedMatches => {
  const committed: string[] = [];
  let truncated = false;
  let invalidUtf8 = 0;
  let binary = 0;
  let currentFileLines: string[] = [];

  for (const rawLine of stdout.split("\n")) {
    if (rawLine === "") continue;

    let entry: unknown;
    try {
      entry = JSON.parse(rawLine);
    } catch {
      continue;
    }
    if (typeof entry !== "object" || entry === null) continue;
    const type = (entry as { type?: unknown }).type;

    if (type === "match") {
      if (!isRgMatch(entry)) continue;
      const { data } = entry;

      if (
        data.path.text === undefined ||
        data.lines.text === undefined
      ) {
        invalidUtf8 += Math.max(1, data.submatches.length);
        continue;
      }

      const relative = path
        .relative(rootReal, path.resolve(rootReal, data.path.text))
        .split(path.sep)
        .join("/");
      const text = truncateLine(
        trimTrailingNewline(data.lines.text),
        maxLineChars,
      );

      for (const submatch of data.submatches) {
        const col = columnOf(data.lines.text, submatch.start);
        currentFileLines.push(
          `${relative}:${data.line_number}:${col}: ${text}`,
        );
      }
      continue;
    }

    if (type === "end") {
      const binaryOffset = (
        entry as { data?: { binary_offset?: unknown } }
      ).data?.binary_offset;

      if (typeof binaryOffset === "number") {
        binary += currentFileLines.length;
      } else {
        for (const line of currentFileLines) {
          if (committed.length >= maxResults) {
            truncated = true;
          } else {
            committed.push(line);
          }
        }
      }
      currentFileLines = [];
    }
  }

  return { lines: committed, truncated, invalidUtf8, binary };
};

const formatOutput = (
  lines: string[],
  truncated: boolean,
  invalidUtf8: number,
  binary: number,
): string => {
  const parts = [...lines];
  if (truncated) parts.push("[results truncated]");
  if (invalidUtf8 > 0) {
    parts.push(`[skipped ${invalidUtf8} matches: not valid UTF-8]`);
  }
  if (binary > 0) {
    parts.push(`[skipped ${binary} matches: binary file]`);
  }
  return parts.join("\n");
};

const hasSummary = (stdout: string): boolean =>
  stdout.split("\n").some((rawLine) => {
    if (rawLine === "") return false;
    try {
      const entry: unknown = JSON.parse(rawLine);
      return (
        typeof entry === "object" &&
        entry !== null &&
        (entry as { type?: unknown }).type === "summary"
      );
    } catch {
      return false;
    }
  });

const rewriteStderrLine = (line: string, rootReal: string): string => {
  const stripped = line.startsWith("rg: ") ? line.slice(4) : line;
  const prefix = `${rootReal}${path.sep}`;
  return stripped.startsWith(prefix)
    ? stripped.slice(prefix.length).split(path.sep).join("/")
    : stripped;
};

const maxIncompleteNoteLines = 5;

const buildIncompleteNote = (
  stderr: string,
  rootReal: string,
): string => {
  const lines = stderr
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => rewriteStderrLine(line, rootReal));
  const shown = lines.slice(0, maxIncompleteNoteLines);
  const remaining = lines.length - shown.length;
  return [
    "[search incomplete: ripgrep reported errors]",
    ...shown,
    ...(remaining > 0 ? [`... and ${remaining} more lines`] : []),
  ].join("\n");
};

export const createGrepTool = (
  options: GrepToolOptions,
): Tool<typeof grepInput> => {
  const {
    root,
    rgPath = "rg",
    timeoutMs = 30_000,
    maxResults = 200,
    maxLineChars = 300,
    maxOutputBytes = 8_388_608,
  } = options;

  return {
    name: "grep",
    description:
      "Searches file contents under the root with ripgrep and returns " +
      "path:line:col: text per match; line and col are what read_file " +
      "accepts. Respects .gitignore. Searches hidden files. Skips " +
      "binary files. At most " +
      `${maxResults} matches.`,
    input: grepInput,
    async execute(
      { pattern, path: inputPath, glob, ignoreCase },
      context,
    ) {
      context.signal?.throwIfAborted();

      const rootReal = await fs.realpath(root);
      const resolved = await resolveExistingPath(
        root,
        inputPath ?? ".",
      );

      const args = [
        "--json",
        "--hidden",
        "-e",
        pattern,
        ...(glob !== undefined ? ["-g", glob] : []),
        ...(ignoreCase === true ? ["-i"] : []),
        "--",
        resolved.absolute,
      ];

      const { stdout, stderr, error } = await run(rgPath, args, {
        cwd: rootReal,
        timeout: timeoutMs,
        maxBuffer: maxOutputBytes,
        signal: context.signal,
      });

      if (error === null) {
        const { lines, truncated, invalidUtf8, binary } = formatMatches(
          stdout,
          rootReal,
          maxResults,
          maxLineChars,
        );
        return formatOutput(lines, truncated, invalidUtf8, binary);
      }

      if (isAbortError(error)) throw error;

      if (error.code === "ENOENT") {
        throw new FileToolError(
          "ripgrep (rg) is not installed or not on PATH",
        );
      }

      if (error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
        const { lines, invalidUtf8, binary } = formatMatches(
          dropTrailingPartialLine(stdout),
          rootReal,
          maxResults,
          maxLineChars,
        );
        const body = formatOutput(lines, true, invalidUtf8, binary);
        return stderr.trim() === ""
          ? body
          : `${body}\n${buildIncompleteNote(stderr, rootReal)}`;
      }

      if (error.killed === true) {
        throw new FileToolError(
          `search timed out after ${timeoutMs} ms`,
        );
      }

      if (error.code === 1) {
        const location =
          resolved.relative === "." ? "the root" : resolved.relative;
        return `No matches for /${pattern}/ in ${location}.`;
      }

      if (error.code === 2 && hasSummary(stdout)) {
        const { lines, truncated, invalidUtf8, binary } = formatMatches(
          stdout,
          rootReal,
          maxResults,
          maxLineChars,
        );
        const location =
          resolved.relative === "." ? "the root" : resolved.relative;
        const body =
          lines.length === 0 &&
          !truncated &&
          invalidUtf8 === 0 &&
          binary === 0
            ? `No matches for /${pattern}/ in ${location}.`
            : formatOutput(lines, truncated, invalidUtf8, binary);
        return `${body}\n${buildIncompleteNote(stderr, rootReal)}`;
      }

      const detail =
        stderr.trim() !== ""
          ? stderr.trim()
          : (error.code ?? error.message);
      throw new FileToolError(`ripgrep failed: ${detail}`);
    },
  };
};
