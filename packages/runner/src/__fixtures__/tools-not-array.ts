export default {
  name: "fixture-tools-not-array",
  provider: {
    generate: async () => ({
      parts: [{ type: "text", text: "hi" }],
      finishReason: "stop",
    }),
    stream: () => {
      throw new Error(
        "tools-not-array fixture: stream is not scripted",
      );
    },
  },
  harness: { kind: "loop", model: "m", maxTurns: 1 },
  tools: "x",
};
