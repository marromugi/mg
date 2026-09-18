import type { Tool } from "@mg/core";
import { z } from "zod";
import type { SshClient } from "./client.js";

export type ShellToolOptions = {
  cwd?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
};

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1_048_576;

const shellInput = z.object({
  command: z.string().describe("Shell command to run"),
});

const quoteForShell = (value: string): string =>
  `'${value.split("'").join("'\\''")}'`;

const trimNewline = (text: string): string =>
  text.endsWith("\n") ? text.slice(0, -1) : text;

export const createShellTool = (
  client: SshClient,
  options: ShellToolOptions,
): Tool<typeof shellInput> => {
  const {
    cwd,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
  } = options;

  return {
    name: "shell",
    description:
      "Runs a shell command on the remote machine over SSH. " +
      "Returns stdout, stderr and the exit code as one text.",
    input: shellInput,
    async execute({ command }, context) {
      const fullCommand =
        cwd === undefined
          ? command
          : `cd ${quoteForShell(cwd)} && ${command}`;

      const result = await client.exec(fullCommand, {
        timeoutMs,
        maxOutputBytes,
        signal: context.signal,
      });

      const parts: string[] = [];
      const out = trimNewline(result.stdout);
      const err = trimNewline(result.stderr);
      if (out !== "") parts.push(out);
      if (err !== "") parts.push(`[stderr]\n${err}`);

      if (result.signal !== null) {
        parts.push(`[killed by ${result.signal}]`);
      } else if (result.code !== null && result.code !== 0) {
        parts.push(`[exit code: ${result.code}]`);
      }
      if (result.timedOut) {
        parts.push(`[timed out after ${timeoutMs} ms]`);
      }
      if (result.truncated) {
        parts.push("[output truncated]");
      }

      return parts.join("\n");
    },
  };
};
