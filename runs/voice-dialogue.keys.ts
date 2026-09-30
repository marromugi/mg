type DataListener = (data: string | Uint8Array) => void;

// The part of a terminal input stream that key reading uses.
export type TerminalInput = {
  isTTY?: boolean;
  setRawMode?: (mode: boolean) => unknown;
  resume: () => unknown;
  pause: () => unknown;
  on: (event: "data", listener: DataListener) => unknown;
  off: (event: "data", listener: DataListener) => unknown;
};

const SPACE = " ";
const CTRL_C = "\u0003";

// Each space key press is one press. Ctrl-C aborts `abort` and ends the
// stream. Other keys are ignored. The terminal is in raw mode while the
// stream is read, and is restored when it ends.
export async function* keyPresses(
  input: TerminalInput,
  abort: AbortController,
): AsyncIterable<void> {
  if (input.isTTY !== true || input.setRawMode === undefined) {
    throw new Error("standard input is not a terminal");
  }
  let presses = 0;
  let wake: (() => void) | undefined;
  const onData: DataListener = (data) => {
    const text =
      typeof data === "string" ? data : new TextDecoder().decode(data);
    for (const key of text) {
      if (key === CTRL_C) {
        abort.abort();
      } else if (key === SPACE && !abort.signal.aborted) {
        presses += 1;
      }
    }
    wake?.();
  };
  const onAbort = () => wake?.();
  abort.signal.addEventListener("abort", onAbort);
  input.setRawMode(true);
  input.resume();
  input.on("data", onData);
  try {
    while (!abort.signal.aborted) {
      if (presses === 0) {
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        continue;
      }
      presses -= 1;
      yield;
    }
  } finally {
    input.off("data", onData);
    abort.signal.removeEventListener("abort", onAbort);
    input.setRawMode(false);
    input.pause();
  }
}
