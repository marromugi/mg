import type { TerminalInput } from "./voice-dialogue.keys.ts";

export const createFakeInput = () => {
  const listeners = new Set<(data: string | Uint8Array) => void>();
  const rawModes: boolean[] = [];
  const input: TerminalInput = {
    isTTY: true,
    setRawMode: (mode) => {
      rawModes.push(mode);
    },
    resume: () => {},
    pause: () => {},
    on: (_event, listener) => {
      listeners.add(listener);
    },
    off: (_event, listener) => {
      listeners.delete(listener);
    },
  };
  return {
    input,
    rawModes,
    emit: (data: string) => {
      for (const listener of listeners) listener(data);
    },
  };
};

export const flush = () =>
  new Promise<void>((resolve) => setImmediate(resolve));
