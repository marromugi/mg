import { spawn } from "node:child_process";

export type SpawnResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

// Runs a command with `stdin` written to it and waits for it to end.
// Rejects when the command cannot be started.
export type SpawnFunction = (
  command: string,
  args: readonly string[],
  stdin: string,
) => Promise<SpawnResult>;

export const spawnProcess: SpawnFunction = (command, args, stdin) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf-8");
    child.stderr.setEncoding("utf-8");
    child.stdout.on("data", (chunk: string) => (stdout += chunk));
    child.stderr.on("data", (chunk: string) => (stderr += chunk));
    child.once("error", reject);
    child.once("close", (code) =>
      resolve({ exitCode: code ?? -1, stdout, stderr }),
    );
    child.stdin.on("error", () => undefined);
    child.stdin.end(stdin);
  });
