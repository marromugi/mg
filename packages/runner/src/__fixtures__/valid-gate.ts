import type { GenerateResponse, Provider, StreamEvent } from "@mg/core";
import type { Gate, Verdict } from "@mg/gate";
import { defineRun } from "../config.js";

const provider: Provider = {
  generate: async (): Promise<GenerateResponse> => ({
    content: "hi",
    toolCalls: [],
    finishReason: "stop",
  }),
  stream: (): AsyncIterable<StreamEvent> => {
    throw new Error("valid-gate fixture: stream is not scripted");
  },
};

const gate: Gate = {
  judge: async (): Promise<Verdict> => ({
    allowed: true,
    reason: "ok",
  }),
};

export default defineRun({
  name: "fixture-valid-gate",
  provider,
  harness: { kind: "loop", model: "m", maxTurns: 1 },
  gate,
});
