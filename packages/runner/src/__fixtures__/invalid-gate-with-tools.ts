import { z } from "zod";

export default {
  name: "fixture-invalid-gate-with-tools",
  provider: {
    toolForcing: true,
    generate: async () => ({
      parts: [{ type: "text", text: "hi" }],
      finishReason: "stop",
    }),
    stream: () => {
      throw new Error(
        "invalid-gate-with-tools fixture: stream is not scripted",
      );
    },
  },
  harness: { kind: "loop", model: "m", maxTurns: 1 },
  tools: [
    {
      name: "a",
      input: z.object({}),
      reach: async () => ({ kind: "any-local" }),
      execute: async () => "a-result",
    },
  ],
  gate: {},
};
