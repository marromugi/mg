import { spawn } from "node:child_process";
import type { Readable } from "node:stream";
import type { ProcessExit, SpawnProcess } from "@mg/voice";

// Reads the stream from the start and holds what it delivers until it
// is read, so an unread output is not lost. The output ends when the
// stream ends or fails; a failure shows through exit.
const outputOf = (stream: Readable): AsyncIterable<Uint8Array> => {
  const held: Uint8Array[] = [];
  let ended = false;
  let wake: (() => void) | undefined;
  stream.on("data", (part: Uint8Array) => {
    held.push(part);
    wake?.();
  });
  const end = () => {
    ended = true;
    wake?.();
  };
  stream.on("end", end);
  stream.on("error", end);
  stream.on("close", end);
  return {
    async *[Symbol.asyncIterator]() {
      for (;;) {
        const part = held.shift();
        if (part !== undefined) {
          yield part;
        } else if (ended) {
          return;
        } else {
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
        }
      }
    },
  };
};

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
