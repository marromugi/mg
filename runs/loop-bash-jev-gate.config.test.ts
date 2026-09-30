import type { EstimateRequest, Estimator, Provider } from "@mg/core";
import { toToolCallRequest } from "@mg/gate";
import { describe, expect, it } from "vitest";

process.env.OPENROUTER_API_KEY = "test";
process.env.TYPESAFE_API_KEY = "test";
const { buildLoopBashJevGateRun } =
  await import("./loop-bash-jev-gate.config.ts");

const provider: Provider = {
  toolForcing: true,
  generate: async () => {
    throw new Error("the provider must not be called");
  },
  stream: () => {
    throw new Error("the provider must not be called");
  },
};

describe("loop-bash-jev-gate gate", () => {
  it("sends the read-only question for a bash call", async () => {
    const requests: EstimateRequest[] = [];
    const estimator: Estimator = {
      model: "fake",
      limits: { maxLabels: 255, maxLevels: 10 },
      estimate: async (request) => {
        requests.push(request);
        return { probability: 1 };
      },
      classify: () => Promise.reject(new Error("not used")),
      score: () => Promise.reject(new Error("not used")),
    };
    const config = buildLoopBashJevGateRun({ provider, estimator });

    await config.gate.judge(
      await toToolCallRequest(config.tools ?? [], {
        id: "c1",
        name: "bash",
        arguments: { command: "ls" },
      }),
    );

    expect(requests.map((request) => request.question)).toEqual([
      "Read-only commands are allowed. Deleting files or sending data outside the machine is not.\n\nIs it fine to run this action?",
    ]);
  });
});
