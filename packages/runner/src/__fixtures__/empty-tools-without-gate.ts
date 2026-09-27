export default {
  name: "fixture-empty-tools-without-gate",
  provider: {
    generate: async () => ({
      parts: [{ type: "text", text: "hi" }],
      finishReason: "stop",
    }),
    stream: () => {
      throw new Error(
        "empty-tools-without-gate fixture: stream is not scripted",
      );
    },
  },
  harness: { kind: "loop", model: "m", maxTurns: 1 },
  tools: [],
};
