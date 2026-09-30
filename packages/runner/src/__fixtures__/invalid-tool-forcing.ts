export default {
  name: "fixture-invalid-tool-forcing",
  provider: {
    toolForcing: "yes",
    generate: async () => ({
      parts: [{ type: "text", text: "hi" }],
      finishReason: "stop",
    }),
    stream: () => {
      throw new Error(
        "invalid-tool-forcing fixture: stream is not scripted",
      );
    },
  },
  harness: { kind: "loop", model: "m", maxTurns: 1 },
};
