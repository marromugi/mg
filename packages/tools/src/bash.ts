import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Tool } from "@mg/core";
import { z } from "zod";
import {
  closingLine,
  createBoundedOutput,
  formatBytes,
  type BoundedOutput,
} from "@mg/bounded-output";

export type BashToolOptions = {
  cwd: string;
  timeoutMs?: number;
  shell?: string;
  maxOutputBytes?: number;
  overflowDir?: string;
  maxSavedBytes?: number;
};

const bashInput = z.object({
  command: z.string().describe("Shell command to run"),
});

type Outcome = {
  output: BoundedOutput;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
};

export const createBashTool = (
  options: BashToolOptions,
): Tool<typeof bashInput> => {
  const {
    cwd,
    timeoutMs = 30_000,
    shell = "/bin/sh",
    maxOutputBytes = 8192,
    overflowDir = join(tmpdir(), "mg-bash-output"),
    maxSavedBytes = 64 * 1024 * 1024,
  } = options;

  const execute = (
    command: string,
    signal: AbortSignal | undefined,
  ): Promise<Outcome> =>
    new Promise((resolve, reject) => {
      const child = spawn(shell, ["-c", command], { cwd, signal });
      let timedOut = false;
      let settled = false;

      const output = createBoundedOutput({
        maxBytes: maxOutputBytes,
        dir: overflowDir,
        maxSavedBytes,
        keep: "end",
        onStop: () => {
          child.kill();
        },
      });
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
        // A background process can keep the pipes open after the shell is gone.
        settle(null, null);
      }, timeoutMs);

      const settle = (
        exitCode: number | null,
        exitSignal: NodeJS.Signals | null,
      ): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.stdout.destroy();
        child.stderr.destroy();
        output.finish().then(
          (bounded) =>
            resolve({
              output: bounded,
              exitCode,
              signal: exitSignal,
              timedOut,
            }),
          reject,
        );
      };

      child.stdout.on("data", (chunk: Buffer) => output.append(chunk));
      child.stderr.on("data", (chunk: Buffer) => output.append(chunk));
      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.kill();
        output.finish().then(
          () => reject(error),
          () => reject(error),
        );
      });
      child.on("close", settle);
      child.on("exit", (code, exitSignal) => {
        if (child.killed) settle(code, exitSignal);
      });
    });

  return {
    name: "bash",
    description:
      `Runs a shell command with ${shell} in the working directory ${cwd}. ` +
      "Returns stdout and stderr merged in arrival order, and the exit code, as one text. " +
      `Output over ${formatBytes(maxOutputBytes)} is cut to its end; ` +
      "the full output is saved to a file whose path is given at the end of the result. " +
      "Read that file with commands such as grep, head, tail or sed -n instead of running the command again.",
    input: bashInput,
    async prepare({ command }) {
      return {
        reach: { kind: "any-local" },
        run: async (context) => {
          const outcome = await execute(command, context.signal);
          const { output } = outcome;

          const parts: string[] = [];
          if (output.text !== "") parts.push(output.text);
          const closing = closingLine(output);
          if (closing !== undefined) parts.push(closing);

          if (output.savedCapReached) {
            const kept = formatBytes(maxSavedBytes);
            parts.push(
              `[stopped: output passed ${kept}; the first ${kept} is saved]`,
            );
          } else if (outcome.timedOut) {
            parts.push(`[timed out after ${timeoutMs} ms]`);
          } else if (outcome.exitCode === null) {
            throw new Error(
              `command ended by signal ${outcome.signal ?? "unknown"}`,
            );
          } else if (outcome.exitCode !== 0) {
            parts.push(`[exit code: ${outcome.exitCode}]`);
          }
          return parts.join("\n");
        },
      };
    },
  };
};
