export default {
  name: "fixture-invalid-provider-name",
  provider: {
    name: 123,
    generate: async () => ({
      content: "hi",
      toolCalls: [],
      finishReason: "stop",
    }),
    stream: () => {
      throw new Error(
        "invalid-provider-name fixture: stream is not scripted",
      );
    },
  },
  harness: { kind: "loop", model: "m", maxTurns: 1 },
};
