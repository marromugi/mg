export default {
  name: "fixture-missing-harness",
  provider: {
    generate: async () => ({
      parts: [{ type: "text", text: "hi" }],
      finishReason: "stop",
    }),
    stream: () => {
      throw new Error(
        "missing-harness fixture: stream is not scripted",
      );
    },
  },
};
