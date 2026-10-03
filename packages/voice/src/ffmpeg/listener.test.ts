import { describe, expect, test } from "vitest";
import type { AudioChunk, AudioFormat } from "../audio.js";
import type { HeardUtterance } from "../listener.js";
import { createFfmpegKeyListener } from "./listener.js";
import type { ProcessExit, SpawnProcess } from "./process.js";

const format: AudioFormat = {
  encoding: "pcm-s16le",
  sampleRate: 16000,
  channels: 1,
};

type FakeProcess = {
  command: string;
  args: string[];
  killed: boolean;
  write(bytes: number[]): void;
  exit(code: number): void;
  exitBySignal(signal: string): void;
};

type OnKill = "signal" | "reject";

const setup = (
  options: { onKill?: OnKill; microphone?: string } = {},
) => {
  const processes: FakeProcess[] = [];
  const spawn: SpawnProcess = (command, args) => {
    let resolveExit: (exit: ProcessExit) => void = () => {};
    let rejectExit: (error: Error) => void = () => {};
    const exit = new Promise<ProcessExit>((resolve, reject) => {
      resolveExit = resolve;
      rejectExit = reject;
    });
    const queue: Uint8Array[] = [];
    let closed = false;
    let wake: () => void = () => {};
    const close = () => {
      closed = true;
      wake();
    };
    const fake: FakeProcess = {
      command,
      args,
      killed: false,
      write: (bytes) => {
        queue.push(new Uint8Array(bytes));
        wake();
      },
      exit: (code) => {
        close();
        resolveExit({ code });
      },
      exitBySignal: (signal) => {
        close();
        resolveExit({ signal });
      },
    };
    processes.push(fake);
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
      exit,
      kill: () => {
        fake.killed = true;
        close();
        if (options.onKill === "reject") {
          rejectExit(new Error("ENOENT"));
        } else resolveExit({ signal: "SIGTERM" });
      },
    };
  };
  let waiting: () => void = () => {};
  let sent = 0;
  let taken = 0;
  const keys: AsyncIterable<void> = (async function* () {
    while (true) {
      await new Promise<void>((resolve) => {
        waiting = resolve;
        if (taken < sent) resolve();
      });
      taken++;
      yield;
    }
  })();
  const press = () => {
    sent++;
    waiting();
  };
  const listener = createFfmpegKeyListener({
    spawn,
    keys,
    microphone: options.microphone,
    format,
  });
  return { processes, press, listener };
};

const tick = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

const collect = async (audio: HeardUtterance["audio"]) => {
  const chunks: AudioChunk[] = [];
  for await (const chunk of audio) chunks.push(chunk);
  return chunks;
};

const firstUtterance = async (
  listener: ReturnType<typeof setup>["listener"],
  signal: AbortSignal,
) => {
  const iterator = listener.listen(signal)[Symbol.asyncIterator]();
  const first = await iterator.next();
  return first.value as HeardUtterance;
};

describe("ffmpeg key listener", () => {
  test("a key press records one utterance until the next press", async () => {
    const { processes, press, listener } = setup();
    const controller = new AbortController();
    press();
    const utterance = await firstUtterance(listener, controller.signal);
    expect(processes.length).toBe(1);
    expect(processes[0].command).toBe("ffmpeg");
    expect(processes[0].args).toEqual([
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
    ]);
    const audio = collect(utterance.audio);
    processes[0].write([1, 2]);
    processes[0].write([3, 4]);
    await tick();
    expect(processes[0].killed).toBe(false);
    press();
    expect(await audio).toEqual([
      { format, data: new Uint8Array([1, 2]) },
      { format, data: new Uint8Array([3, 4]) },
    ]);
    expect(processes[0].killed).toBe(true);
    controller.abort();
  });

  test("a named microphone is passed to ffmpeg as the audio input", async () => {
    const { processes, press, listener } = setup({
      microphone: "MacBook Proのマイク",
    });
    const controller = new AbortController();
    press();
    await firstUtterance(listener, controller.signal);
    expect(processes[0].args.slice(4, 7)).toEqual([
      "avfoundation",
      "-i",
      ":MacBook Proのマイク",
    ]);
    controller.abort();
  });

  test("aborting kills the process and ends the audio and the listening without error", async () => {
    const { processes, press, listener } = setup();
    const controller = new AbortController();
    const utterances: HeardUtterance[] = [];
    const done = (async () => {
      for await (const utterance of listener.listen(
        controller.signal,
      )) {
        utterances.push(utterance);
      }
    })();
    press();
    await tick();
    const audio = collect(utterances[0].audio);
    controller.abort();
    expect(await audio).toEqual([]);
    await done;
    expect(processes[0].killed).toBe(true);
  });

  describe("a recording that ends", () => {
    const outcome = async (
      end: "exit 1" | "signal" | "key",
      onKill?: OnKill,
    ): Promise<string> => {
      const { processes, press, listener } = setup({ onKill });
      const controller = new AbortController();
      press();
      const utterance = await firstUtterance(
        listener,
        controller.signal,
      );
      const audio = collect(utterance.audio);
      await tick();
      if (end === "key") press();
      else if (end === "signal") processes[0].exitBySignal("SIGTERM");
      else processes[0].exit(1);
      const result = await audio.then(
        () => "ended",
        (error: Error) => error.message,
      );
      controller.abort();
      return result;
    };

    test("throws with the exit code", async () => {
      expect(await outcome("exit 1")).toContain("exit code 1");
    });

    test("throws naming a signal the listener did not send", async () => {
      expect(await outcome("signal")).toContain("SIGTERM");
    });

    test("does not throw when the listener's own kill ends it", async () => {
      expect(await outcome("key")).toBe("ended");
    });

    test("throws with the error when the process cannot run", async () => {
      expect(await outcome("key", "reject")).toContain("ENOENT");
    });
  });
});
