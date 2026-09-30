import { describe, expect, test, vi } from "vitest";
import type { AudioChunk } from "../audio.js";
import { createFfmpegPlayer } from "./player.js";
import type { ProcessExit, SpawnProcess } from "./process.js";

type FakeProcess = {
  command: string;
  args: string[];
  written: Uint8Array[];
  stdinClosed: boolean;
  killed: boolean;
  exit(code: number): void;
  exitBySignal(signal: string): void;
};

async function* noOutput(): AsyncIterable<Uint8Array> {}

const setup = (options: { throwOnSpawn?: Error } = {}) => {
  const processes: FakeProcess[] = [];
  const spawn: SpawnProcess = (command, args) => {
    if (options.throwOnSpawn !== undefined) throw options.throwOnSpawn;
    let resolveExit: (exit: ProcessExit) => void = () => {};
    const exit = new Promise<ProcessExit>((resolve) => {
      resolveExit = resolve;
    });
    const fake: FakeProcess = {
      command,
      args,
      written: [],
      stdinClosed: false,
      killed: false,
      exit: (code) => resolveExit({ code }),
      exitBySignal: (signal) => resolveExit({ signal }),
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
      stdout: noOutput(),
      exit,
      kill: () => {
        fake.killed = true;
        resolveExit({ code: 143 });
      },
    };
  };
  return { processes, player: createFfmpegPlayer({ spawn }) };
};

const chunk = (
  bytes: number[],
  sampleRate = 24000,
  channels = 1,
): AudioChunk => ({
  format: { encoding: "pcm-s16le", sampleRate, channels },
  data: new Uint8Array(bytes),
});

async function* audioOf(
  ...chunks: AudioChunk[]
): AsyncIterable<AudioChunk> {
  for (const c of chunks) yield c;
}

const flush = () => new Promise<void>((r) => setImmediate(r));

describe("ffmpeg player", () => {
  test("starts ffmpeg for the chunk format, writes the chunk to stdin and closes it", async () => {
    const { processes, player } = setup();
    const done = player.play(0, audioOf(chunk([1, 2, 3, 4])));
    await vi.waitFor(() =>
      expect(processes[0]?.stdinClosed).toBe(true),
    );
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
    processes[0].exit(0);
    await done;
  });

  test("starts the next sentence only after the previous one exits with 0", async () => {
    const { processes, player } = setup();
    const first = player.play(0, audioOf(chunk([1, 2])));
    const second = player.play(1, audioOf(chunk([3, 4])));
    await vi.waitFor(() => expect(processes).toHaveLength(1));
    await flush();
    expect(processes).toHaveLength(1);
    processes[0].exit(0);
    await vi.waitFor(() => expect(processes).toHaveLength(2));
    await expect(first).resolves.toEqual({ played: true });
    processes[1].exit(0);
    await second;
  });

  test("stopping kills the running process and resolves both plays as not played", async () => {
    const { processes, player } = setup();
    const first = player.play(0, audioOf(chunk([1, 2])));
    const second = player.play(1, audioOf(chunk([3, 4])));
    await vi.waitFor(() => expect(processes).toHaveLength(1));
    player.stop();
    await expect(first).resolves.toEqual({ played: false });
    await expect(second).resolves.toEqual({ played: false });
    expect(processes[0].killed).toBe(true);
    await flush();
    expect(processes).toHaveLength(1);
  });

  test("a second text's index 1 starts only after that text's index 0 exits", async () => {
    const { processes, player } = setup();
    const a0 = player.play(0, audioOf(chunk([1, 2])));
    const a1 = player.play(1, audioOf(chunk([3, 4])));
    await vi.waitFor(() => expect(processes).toHaveLength(1));
    processes[0].exit(0);
    await vi.waitFor(() => expect(processes).toHaveLength(2));
    processes[1].exit(0);
    await Promise.all([a0, a1]);

    const b0 = player.play(0, audioOf(chunk([5, 6])));
    const b1 = player.play(1, audioOf(chunk([7, 8])));
    await vi.waitFor(() => expect(processes).toHaveLength(3));
    await flush();
    expect(processes).toHaveLength(3);
    processes[2].exit(0);
    await vi.waitFor(() => expect(processes).toHaveLength(4));
    processes[3].exit(0);
    await Promise.all([b0, b1]);
  });

  describe("index rules", () => {
    test("index 1 with no text begun rejects naming no text", async () => {
      const { player } = setup();
      await expect(
        player.play(1, audioOf(chunk([1, 2]))),
      ).rejects.toThrow(/no text/);
    });

    test("index 0 while an earlier text's sentence is playing rejects naming index 0", async () => {
      const { processes, player } = setup();
      const first = player.play(0, audioOf(chunk([1, 2])));
      await vi.waitFor(() => expect(processes).toHaveLength(1));
      await expect(
        player.play(0, audioOf(chunk([3, 4]))),
      ).rejects.toThrow(/index 0/);
      processes[0].exit(0);
      await first;
    });

    test("index 2 right after index 0 rejects naming skip", async () => {
      const { processes, player } = setup();
      const first = player.play(0, audioOf(chunk([1, 2])));
      await vi.waitFor(() => expect(processes).toHaveLength(1));
      await expect(
        player.play(2, audioOf(chunk([3, 4]))),
      ).rejects.toThrow(/skip/);
      processes[0].exit(0);
      await first;
    });

    test("index 1 twice rejects the second naming repeat", async () => {
      const { processes, player } = setup();
      const first = player.play(0, audioOf(chunk([1, 2])));
      const second = player.play(1, audioOf(chunk([3, 4])));
      await expect(
        player.play(1, audioOf(chunk([5, 6]))),
      ).rejects.toThrow(/repeat/);
      await vi.waitFor(() => expect(processes).toHaveLength(1));
      processes[0].exit(0);
      await vi.waitFor(() => expect(processes).toHaveLength(2));
      processes[1].exit(0);
      await Promise.all([first, second]);
    });
  });

  test("index 0 right after a stop starts a new process and resolves played when it exits with 0", async () => {
    const { processes, player } = setup();
    const cut = player.play(0, audioOf(chunk([1, 2])));
    await vi.waitFor(() => expect(processes).toHaveLength(1));
    player.stop();
    await cut;
    const next = player.play(0, audioOf(chunk([3, 4])));
    await vi.waitFor(() => expect(processes).toHaveLength(2));
    processes[1].exit(0);
    await expect(next).resolves.toEqual({ played: true });
  });

  test("a chunk at another rate rejects naming both rates and kills the process", async () => {
    const { processes, player } = setup();
    const done = player.play(
      0,
      audioOf(chunk([1, 2], 24000, 1), chunk([3, 4], 16000, 1)),
    );
    await expect(done).rejects.toThrow(/24000.*16000/);
    expect(processes[0].killed).toBe(true);
  });

  describe("failures", () => {
    test("exit code 1 rejects naming exit code 1", async () => {
      const { processes, player } = setup();
      const done = player.play(0, audioOf(chunk([1, 2])));
      await vi.waitFor(() => expect(processes).toHaveLength(1));
      processes[0].exit(1);
      await expect(done).rejects.toThrow(/exit code 1/);
    });

    test("a process ended by SIGKILL rejects naming SIGKILL", async () => {
      const { processes, player } = setup();
      const done = player.play(0, audioOf(chunk([1, 2])));
      await vi.waitFor(() => expect(processes).toHaveLength(1));
      processes[0].exitBySignal("SIGKILL");
      await expect(done).rejects.toThrow(/SIGKILL/);
    });

    test("a start that throws ENOENT rejects naming ENOENT", async () => {
      const { player } = setup({ throwOnSpawn: new Error("ENOENT") });
      await expect(
        player.play(0, audioOf(chunk([1, 2]))),
      ).rejects.toThrow(/ENOENT/);
    });
  });
});
