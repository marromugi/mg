// Asks an Estimator, for each pair of agent reply and developer response,
// whether the developer overrode the agent's design. The Estimator is passed
// in; this file knows no vendor.

import type { Estimator } from "../../../../packages/core/dist/index.js";
import type { Turn } from "./turns.mts";

export type JudgedTurn = Turn & { override: number };

const AGENT_TEXT_LIMIT = 6000;
const CONCURRENCY = 4;

export const QUESTION =
  "Did the developer reject, correct, or replace a design choice that the agent had proposed or already made? A design choice is about structure, responsibility, an interface, a name, failure behaviour, or the working process. An approval, a new request, a factual answer, and an operational instruction such as merging do not count.";

const pairOf = (turn: Turn): string =>
  [
    "Agent:",
    turn.agent.slice(-AGENT_TEXT_LIMIT),
    "",
    turn.interrupted
      ? "Developer (after interrupting the agent):"
      : "Developer:",
    turn.text,
  ].join("\n");

const judgeTurn = async (
  estimator: Estimator,
  turn: Turn,
): Promise<JudgedTurn> => {
  if (turn.agent === "") return { ...turn, override: 0 };
  const { probability } = await estimator.estimate({
    text: pairOf(turn),
    question: QUESTION,
  });
  return { ...turn, override: probability };
};

export const judgeTurns = async (
  estimator: Estimator,
  turns: readonly Turn[],
): Promise<JudgedTurn[]> => {
  const judged = new Map<number, JudgedTurn>();
  const pending = [...turns.entries()];
  const worker = async (): Promise<void> => {
    for (let next = pending.shift(); next; next = pending.shift()) {
      const [index, turn] = next;
      judged.set(index, await judgeTurn(estimator, turn));
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return turns.flatMap((_, index) => judged.get(index) ?? []);
};
