import { spawn } from "node:child_process";
import type { Readable } from "node:stream";
import type { ProcessExit, SpawnProcess } from "@mg/voice";

// The stream's failures end the output; they show through exit.
async function* outputOf(stream: Readable): AsyncIterable<Uint8Array> {
  try {
    for await (const part of stream) yield part as Uint8Array;
  } catch {
    // The process's exit says what went wrong.
  }
}

export const spawnProcess: SpawnProcess = (command, args) => {
  const child = spawn(command, args, {
    stdio: ["pipe", "pipe", "inherit"],
  });
  child.stdin.on("error", () => {});
  const exit = new Promise<ProcessExit>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) => {
      resolve(signal === null ? { code: code ?? -1 } : { signal });
    });
  });
  return {
    stdin: {
      write: (data) => {
        child.stdin.write(data);
      },
      end: () => {
        child.stdin.end();
      },
    },
    stdout: outputOf(child.stdout),
    exit,
    kill: () => {
      child.kill();
    },
  };
};
