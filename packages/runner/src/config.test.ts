import type { GenerateResponse, Provider, StreamEvent } from "@mg/core";
import { describe, expect, test, vi } from "vitest";
import type { RunConfig } from "./config.js";
import { defineRun } from "./config.js";

const stubProvider = (): Provider => {
  const generate = vi.fn(async (): Promise<GenerateResponse> => {
    throw new Error("stubProvider: generate is not scripted");
  });
  const stream = vi.fn((): AsyncIterable<StreamEvent> => {
    throw new Error("stubProvider: stream is not scripted");
  });
  return { generate, stream };
};

describe("defineRun", () => {
  test("returns its argument unchanged", () => {
    const config: RunConfig = {
      name: "example",
      provider: stubProvider(),
      harness: { kind: "loop", model: "m", maxTurns: 1 },
    };

    expect(defineRun(config)).toBe(config);
  });
});
