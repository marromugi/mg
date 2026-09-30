import type { Provider } from "@mg/core";
import { describe, expect, test } from "vitest";
import { createExclusiveNames } from "./exclusive-names.js";
import { createSubagent } from "./subagent.js";

describe("subagent reach", () => {
  test("is none for every argument and never calls the provider", async () => {
    let calls = 0;
    const provider: Provider = {
      toolForcing: true,
      generate: async () => {
        calls++;
        throw new Error("the provider must not be called");
      },
      stream: () => {
        calls++;
        throw new Error("the provider must not be called");
      },
    };
    const subagent = createSubagent(
      {
        name: "researcher",
        description: "Researches a topic",
        provider,
        harness: {
          kind: "loop",
          model: "m",
          maxTurns: 1,
          stream: false,
        },
      },
      {
        exclusive: createExclusiveNames(),
        parentExclusiveNames: [],
      },
    );

    expect(await subagent.reach({ prompt: "hi" })).toEqual({
      kind: "none",
    });
    expect(await subagent.reach({})).toEqual({ kind: "none" });
    expect(calls).toBe(0);
  });
});
