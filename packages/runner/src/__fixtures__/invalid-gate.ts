import type { GenerateResponse, Provider, StreamEvent } from "@mg/core";
import { defineRun } from "../config.js";

const provider: Provider = {
  generate: async (): Promise<GenerateResponse> => ({
    parts: [{ type: "text", text: "hi" }],
    finishReason: "stop",
  }),
  stream: (): AsyncIterable<StreamEvent> => {
    throw new Error("invalid-gate fixture: stream is not scripted");
  },
};

export default {
  ...defineRun({
    name: "fixture-invalid-gate",
    provider,
    harness: { kind: "loop", model: "m", maxTurns: 1 },
  }),
  gate: {},
};
