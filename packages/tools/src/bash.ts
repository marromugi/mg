import { execFile, type ExecFileException } from "node:child_process";
import type { Tool } from "@mg/core";
import { z } from "zod";

export type BashToolOptions = {
  cwd: string;
  timeoutMs?: number;
  shell?: string;
  maxOutputBytes?: number;
};

const bashInput = z.object({ command: z.string().describe("Shell command to run") });

type RunResult = { stdout: string; stderr: string; error: ExecFileException | null };

const run = (
  shell: string,
  command: string,
  options: { cwd: string; timeout: number; maxBuffer: number; signal?: AbortSignal },
): Promise<RunResult> =>
  new Promise((resolve) => {
    execFile(shell, ["-c", command], options, (error, stdout, stderr) => {
      resolve({ stdout, stderr, error });
    });
  });

const trimNewline = (text: string): string => (text.endsWith("\n") ? text.slice(0, -1) : text);

export const createBashTool = (options: BashToolOptions): Tool<typeof bashInput> => {
  const { cwd, timeoutMs = 30_000, shell = "/bin/sh", maxOutputBytes = 1_048_576 } = options;

  return {
    name: "bash",
    description:
      `Runs a shell command with ${shell} in the working directory ${cwd}. ` +
      "Returns stdout, stderr and the exit code as one text.",
    input: bashInput,
    async execute({ command }, context) {
      const { stdout, stderr, error } = await run(shell, command, {
        cwd,
        timeout: timeoutMs,
        maxBuffer: maxOutputBytes,
        signal: context.signal,
      });

      const parts: string[] = [];
      const out = trimNewline(stdout);
      const err = trimNewline(stderr);
      if (out !== "") parts.push(out);
      if (err !== "") parts.push(`[stderr]\n${err}`);

      if (error === null) return parts.join("\n");
      if (error.name === "AbortError") throw error;
      if (error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
        parts.push("[output truncated]");
      } else if (error.killed === true) {
        parts.push(`[timed out after ${timeoutMs} ms]`);
      } else if (typeof error.code === "number") {
        parts.push(`[exit code: ${error.code}]`);
      } else {
        throw error;
      }
      return parts.join("\n");
    },
  };
};
