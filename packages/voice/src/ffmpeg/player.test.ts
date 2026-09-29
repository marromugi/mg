import { describe, expect, test, vi } from "vitest";
import type { AudioChunk } from "../audio.js";
import { createFfmpegPlayer } from "./player.js";
import type { SpawnProcess } from "./player.js";

type FakeProcess = {
  command: string;
  args: string[];
  written: Uint8Array[];
  stdinClosed: boolean;
  killed: boolean;
  exit(code: number): void;
};

const setup = (options: { throwOnSpawn?: Error } = {}) => {
  const processes: FakeProcess[] = [];
  const spawn: SpawnProcess = (command, args) => {
    if (options.throwOnSpawn !== undefined) throw options.throwOnSpawn;
    let resolveExit: (code: number) => void = () => {};
    const exit = new Promise<number>((resolve) => {
      resolveExit = resolve;
    });
    const fake: FakeProcess = {
      command,
      args,
      written: [],
      stdinClosed: false,
      killed: false,
      exit: (code) => resolveExit(code),
    };
    processes.push(fake);
    return {
      stdin: {
        write: (data) => {
          fake.written.push(data);
        },
        end: () => {
          fake.stdinClosed = true;
        },
      },
      exit,
      kill: () => {
        fake.killed = true;
        resolveExit(143);
      },
    };
  };
  return { processes, player: createFfmpegPlayer({ spawn }) };
};

const chunk = (bytes: number[]): AudioChunk => ({
  format: { encoding: "pcm-s16le", sampleRate: 24000, channels: 1 },
  data: new Uint8Array(bytes),
});

async function* audioOf(
  ...chunks: AudioChunk[]
): AsyncIterable<AudioChunk> {
  for (const c of chunks) yield c;
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe("createFfmpegPlayer", () => {
  test("starts ffmpeg for the chunk format and writes the bytes to its stdin, then closes it", async () => {
    const { processes, player } = setup();
    const done = player.play(0, audioOf(chunk([1, 2, 3, 4])));
    await vi.waitFor(() =>
      expect(processes[0]?.stdinClosed).toBe(true),
    );

    expect(processes).toHaveLength(1);
    expect(processes[0].command).toBe("ffmpeg");
    expect(processes[0].args).toEqual([
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "s16le",
      "-ar",
      "24000",
      "-ac",
      "1",
      "-i",
      "pipe:0",
      "-f",
      "audiotoolbox",
      "-",
    ]);
    expect(processes[0].written).toEqual([
      new Uint8Array([1, 2, 3, 4]),
    ]);
    expect(processes[0].stdinClosed).toBe(true);

    processes[0].exit(0);
    await done;
  });

  test("starts the next sentence only after the previous one exits, and resolves played true", async () => {
    const { processes, player } = setup();
    const first = player.play(0, audioOf(chunk([1, 2])));
    const second = player.play(1, audioOf(chunk([3, 4])));
    await vi.waitFor(() => expect(processes).toHaveLength(1));
    await flush();
    expect(processes).toHaveLength(1);

    processes[0].exit(0);
    await expect(first).resolves.toEqual({ played: true });
    await vi.waitFor(() => expect(processes).toHaveLength(2));
    expect(processes).toHaveLength(2);

    processes[1].exit(0);
    await expect(second).resolves.toEqual({ played: true });
  });

  test("stop kills the running process and resolves every pending play as not played without starting another", async () => {
    const { processes, player } = setup();
    const first = player.play(0, audioOf(chunk([1, 2])));
    const second = player.play(1, audioOf(chunk([3, 4])));
    await vi.waitFor(() => expect(processes).toHaveLength(1));

    player.stop();

    await expect(first).resolves.toEqual({ played: false });
    await expect(second).resolves.toEqual({ played: false });
    await flush();
    expect(processes).toHaveLength(1);
    expect(processes[0].killed).toBe(true);
  });

  test("rejects with the exit code when the process exits with another code", async () => {
    const { processes, player } = setup();
    const done = player.play(0, audioOf(chunk([1, 2])));
    const failure = done.then(
      () => undefined,
      (error: unknown) => error,
    );
    await vi.waitFor(() => expect(processes).toHaveLength(1));
    processes[0].exit(1);
    expect(String(await failure)).toContain("exit code 1");
  });

  test("rejects with the start error when the process cannot start", async () => {
    const { player } = setup({ throwOnSpawn: new Error("ENOENT") });
    await expect(
      player.play(0, audioOf(chunk([1, 2]))),
    ).rejects.toThrow("ENOENT");
  });
});
