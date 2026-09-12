export default {
  name: "fixture-missing-harness",
  provider: {
    generate: async () => ({ content: "hi", toolCalls: [], finishReason: "stop" }),
    stream: () => {
      throw new Error("missing-harness fixture: stream is not scripted");
    },
  },
};
