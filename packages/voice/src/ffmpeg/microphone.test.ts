import { describe, expect, test } from "vitest";
import type { AudioChunk, AudioFormat } from "../audio.js";
import { createFfmpegMicrophone } from "./microphone.js";
import type { ProcessExit, SpawnProcess } from "./process.js";

const format: AudioFormat = {
  encoding: "pcm-s16le",
  sampleRate: 16000,
  channels: 1,
};

const setup = (options: { microphone?: string } = {}) => {
  const started: { command: string; args: string[] }[] = [];
  let killed = false;
  let write: (bytes: number[]) => void = () => {};
  let exit: (code: number) => void = () => {};
  const spawn: SpawnProcess = (command, args) => {
    started.push({ command, args });
    let resolveExit: (value: ProcessExit) => void = () => {};
    const exited = new Promise<ProcessExit>((resolve) => {
      resolveExit = resolve;
    });
    const queue: Uint8Array[] = [];
    let closed = false;
    let wake: () => void = () => {};
    write = (bytes) => {
      queue.push(new Uint8Array(bytes));
      wake();
    };
    exit = (code) => {
      closed = true;
      wake();
      resolveExit({ code });
    };
    return {
      stdin: { write: () => {}, end: () => {} },
      stdout: (async function* () {
        while (true) {
          const next = queue.shift();
          if (next !== undefined) yield next;
          else if (closed) return;
          else {
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
          }
        }
      })(),
      exit: exited,
      kill: () => {
        killed = true;
        closed = true;
        wake();
        resolveExit({ signal: "SIGTERM" });
      },
    };
  };
  const microphone = createFfmpegMicrophone({
    spawn,
    microphone: options.microphone,
    format,
  });
  return {
    microphone,
    started,
    write: (bytes: number[]) => write(bytes),
    exit: (code: number) => exit(code),
    killed: () => killed,
  };
};

const tick = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

const collect = async (audio: AsyncIterable<AudioChunk>) => {
  const chunks: AudioChunk[] = [];
  for await (const chunk of audio) chunks.push(chunk);
  return chunks;
};

describe("ffmpeg microphone", () => {
  test("streams what ffmpeg writes until the signal fires, then ends without error", async () => {
    const t = setup();
    const controller = new AbortController();
    const audio = collect(t.microphone.open(controller.signal));
    await tick();
    t.write([1, 2]);
    t.write([3, 4]);
    await tick();
    controller.abort();
    expect(await audio).toEqual([
      { format, data: new Uint8Array([1, 2]) },
      { format, data: new Uint8Array([3, 4]) },
    ]);
    expect(t.killed()).toBe(true);
    expect(t.started).toEqual([
      {
        command: "ffmpeg",
        args: [
          "-hide_banner",
          "-loglevel",
          "error",
          "-f",
          "avfoundation",
          "-i",
          ":default",
          "-f",
          "s16le",
          "-ar",
          "16000",
          "-ac",
          "1",
          "pipe:1",
        ],
      },
    ]);
  });

  test("reads the microphone given by name", async () => {
    const t = setup({ microphone: "MacBook Proのマイク" });
    const controller = new AbortController();
    const audio = collect(t.microphone.open(controller.signal));
    await tick();
    controller.abort();
    await audio;
    expect(t.started[0].args.slice(4, 7)).toEqual([
      "avfoundation",
      "-i",
      ":MacBook Proのマイク",
    ]);
  });

  test("throws with the exit code when ffmpeg fails", async () => {
    const t = setup();
    const controller = new AbortController();
    const audio = collect(t.microphone.open(controller.signal));
    await tick();
    t.exit(1);
    await expect(audio).rejects.toThrow("exit code 1");
    controller.abort();
  });
});
