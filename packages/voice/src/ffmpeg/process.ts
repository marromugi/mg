// How a process ended: by exiting with a code, or by a signal, named.
export type ProcessExit = { code: number } | { signal: string };

// A started process: what it is given, what it wrote, how it ended, and a
// way to end it. stdout ends when the process closes it and never throws.
// exit rejects when the process cannot run.
export interface SpawnedProcess {
  stdin: { write(data: Uint8Array): void; end(): void };
  stdout: AsyncIterable<Uint8Array>;
  exit: Promise<ProcessExit>;
  kill(): void;
}

export type SpawnProcess = (
  command: string,
  args: string[],
) => SpawnedProcess;
