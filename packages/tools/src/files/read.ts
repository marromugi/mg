import { constants } from "node:fs";
import type { Tool } from "@mg/core";
import { z } from "zod";
import { FileToolError } from "./errors.js";
import { openDeclared } from "./checked.js";
import { declaredTarget, reachOfFile } from "./root.js";
import { isBinary, sliceCodePoints, splitLines } from "./text.js";

export type ReadFileToolOptions = {
  root: string;
  maxOutputChars?: number;
};

const position = z.object({
  line: z.number().int().min(1),
  col: z.number().int().min(1).optional(),
});

const readFileInput = z.object({
  path: z.string().min(1).describe("File path relative to the root"),
  range: z
    .object({ start: position, end: position.optional() })
    .optional()
    .describe("Lines/positions to read; omit for the whole file"),
});

const truncate = (text: string, maxOutputChars: number): string => {
  const chars = Array.from(text);
  if (chars.length <= maxOutputChars) return text;
  return `${chars.slice(0, maxOutputChars).join("")}\n[output truncated]`;
};

export const createReadFileTool = (
  options: ReadFileToolOptions,
): Tool<typeof readFileInput> => {
  const { root, maxOutputChars = 100_000 } = options;

  return {
    name: "read_file",
    description:
      "Reads a UTF-8 text file under the root. Every line is prefixed " +
      "with its 1-based line number and a tab. range.start and " +
      "range.end each take a line and an optional col (1-based code " +
      "points, start inclusive, end exclusive; a bare line means the " +
      "whole line). Positions are the ones grep reports.",
    input: readFileInput,
    async prepare({ path: inputPath, range }) {
      const reach = await reachOfFile(root, inputPath);
      return {
        reach,
        run: async (context) => {
          context.signal?.throwIfAborted();

          const resolved = await declaredTarget(root, inputPath, reach);
          const handle = await openDeclared(
            resolved.absolute,
            constants.O_RDONLY,
            { root },
          );
          let content: string;
          try {
            content = await handle.readFile({
              encoding: "utf-8",
              signal: context.signal,
            });
          } finally {
            await handle.close();
          }

          if (isBinary(content)) {
            throw new FileToolError(
              `binary file: ${resolved.relative}`,
            );
          }

          const lines = splitLines(content);
          if (lines.length === 0) return "(empty file)";

          const startLine = range?.start.line ?? 1;
          const hasEnd = range?.end !== undefined;
          const endLine = range?.end?.line ?? lines.length;

          if (hasEnd && endLine < startLine) {
            throw new FileToolError(
              `range end (line ${endLine}) is before start (line ${startLine})`,
            );
          }
          if (startLine > lines.length) {
            throw new FileToolError(
              `line ${startLine} is beyond the end of the file (${lines.length} lines)`,
            );
          }
          if (hasEnd && endLine > lines.length) {
            throw new FileToolError(
              `line ${endLine} is beyond the end of the file (${lines.length} lines)`,
            );
          }

          const selected = lines.slice(startLine - 1, endLine);
          const lastIndex = selected.length - 1;
          const formatted = selected
            .map((line, index) => {
              const lineNumber = startLine + index;
              const startCol =
                index === 0 ? range?.start.col : undefined;
              const endCol =
                index === lastIndex ? range?.end?.col : undefined;
              const text =
                startCol !== undefined || endCol !== undefined
                  ? sliceCodePoints(line, startCol ?? 1, endCol)
                  : line;
              return `${lineNumber}\t${text}`;
            })
            .join("\n");

          return truncate(formatted, maxOutputChars);
        },
      };
    },
  };
};
