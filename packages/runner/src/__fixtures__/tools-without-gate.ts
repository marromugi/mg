import { z } from "zod";

export default {
  name: "fixture-tools-without-gate",
  provider: {
    toolForcing: true,
    generate: async () => ({
      parts: [{ type: "text", text: "hi" }],
      finishReason: "stop",
    }),
    stream: () => {
      throw new Error(
        "tools-without-gate fixture: stream is not scripted",
      );
    },
  },
  harness: { kind: "loop", model: "m", maxTurns: 1 },
  tools: [
    {
      name: "a",
      input: z.object({}),
      async prepare() {
        return {
          reach: { kind: "any-local" },
          run: async () => "a-result",
        };
      },
    },
  ],
};
