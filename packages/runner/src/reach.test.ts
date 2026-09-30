import type { Provider } from "@mg/core";
import { prepareSubagentCall, type Subagent } from "@mg/harness";
import { describe, expect, test } from "vitest";
import { createExclusiveNames } from "./exclusive-names.js";
import { createSubagent } from "./subagent.js";

const reachOf = async (subagent: Subagent, args: unknown) =>
  (
    await prepareSubagentCall([subagent], {
      id: "c1",
      name: subagent.name,
      arguments: args,
    })
  ).reach;

describe("subagent reach", () => {
  test("is none and never calls the provider", async () => {
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

    expect(await reachOf(subagent, { prompt: "hi" })).toEqual({
      kind: "none",
    });
    expect(calls).toBe(0);
  });
});
