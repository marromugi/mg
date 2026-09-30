import type { GenerateResponse, Provider, StreamEvent } from "@mg/core";
import { defineRun } from "../config.js";

const provider: Provider = {
  toolForcing: false,
  generate: async (): Promise<GenerateResponse> => ({
    parts: [{ type: "text", text: "hi" }],
    finishReason: "stop",
  }),
  stream: (): AsyncIterable<StreamEvent> => {
    throw new Error(
      "valid-no-tool-forcing fixture: stream is not scripted",
    );
  },
};

export default defineRun({
  name: "fixture-valid-no-tool-forcing",
  provider,
  harness: { kind: "loop", model: "m", maxTurns: 1 },
});
