import type { GenerateResponse, Provider, StreamEvent } from "@mg/core";
import { defineRun } from "../config.js";

const provider: Provider = {
  generate: async (): Promise<GenerateResponse> => ({
    content: "hi",
    toolCalls: [],
    finishReason: "stop",
  }),
  stream: (): AsyncIterable<StreamEvent> => {
    throw new Error("valid fixture: stream is not scripted");
  },
};

export default defineRun({
  name: "fixture-valid",
  provider,
  harness: { kind: "loop", model: "m", maxTurns: 1 },
});
