import { test } from "node:test";
import assert from "node:assert/strict";
import type { Estimator } from "../../../../packages/core/dist/index.js";
import { judgeTurns } from "./judge.mts";
import type { Turn } from "./turns.mts";

const QUESTION =
  "Did the developer reject, correct, or replace a design choice that the agent had proposed or already made? A design choice is about structure, responsibility, an interface, a name, failure behaviour, or the working process. An approval, a new request, a factual answer, and an operational instruction such as merging do not count.";

const turn: Turn = {
  id: "session#1",
  time: "10:00",
  iso: "2026-01-01T10:00:00.000Z",
  skill: "",
  interrupted: false,
  agent: "A",
  kind: "typed",
  text: "B",
};

test("asks the estimator for the agent/developer pair once and carries back its probability as the override", async () => {
  const calls: unknown[] = [];
  const estimator: Estimator = {
    model: "fake-model",
    estimate: (request) => {
      calls.push(request);
      return Promise.resolve({ probability: 0.42 });
    },
  };

  const judged = await judgeTurns(estimator, [turn]);

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    subject: "Agent:\nA\n\nDeveloper:\nB",
    question: QUESTION,
  });
  assert.equal(judged.length, 1);
  assert.equal(judged[0]?.override, 0.42);
});
