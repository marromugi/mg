import { describe, expect, test } from "vitest";
import { keyPresses } from "./voice-dialogue.keys.ts";
import { createFakeInput, flush } from "./fake-terminal.ts";

describe("keyPresses", () => {
  test("yields one press per space key and ignores other keys", async () => {
    const terminal = createFakeInput();
    const abort = new AbortController();
    let presses = 0;
    const reading = (async () => {
      for await (const _ of keyPresses(terminal.input, abort))
        presses += 1;
    })();
    await flush();

    terminal.emit(" ");
    terminal.emit("a");
    terminal.emit(" ");
    await flush();
    terminal.emit("\u0003");
    await reading;

    expect(presses).toBe(2);
  });
});
