export default {
  name: "fixture-workspace-without-gate",
  provider: {
    generate: async () => ({
      parts: [{ type: "text", text: "hi" }],
      finishReason: "stop",
    }),
    stream: () => {
      throw new Error(
        "workspace-without-gate fixture: stream is not scripted",
      );
    },
  },
  harness: { kind: "loop", model: "m", maxTurns: 1 },
  workspace: { name: "fixture-workspace", connectors: [] },
};
