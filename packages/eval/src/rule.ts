import type { Check, CheckOutcome, EvalInput } from "./types.js";
import type { RunView } from "./view.js";

export type RuleOutcome =
  boolean | { passed: boolean; reason?: string; details?: unknown };

export type RulePredicate = (
  view: RunView,
  input: EvalInput,
) => RuleOutcome | Promise<RuleOutcome>;

const toCheckOutcome = (outcome: RuleOutcome): CheckOutcome => {
  if (typeof outcome === "boolean") {
    return {
      passed: outcome,
      reason: outcome ? "rule passed" : "rule failed",
    };
  }

  return {
    passed: outcome.passed,
    reason:
      outcome.reason ??
      (outcome.passed ? "rule passed" : "rule failed"),
    details: outcome.details,
  };
};

export const rule = (name: string, predicate: RulePredicate): Check => {
  if (name === "") {
    throw new RangeError("rule name must not be empty");
  }

  return {
    name,
    async evaluate(input: EvalInput): Promise<CheckOutcome> {
      const outcome = await predicate(input.view, input);
      return toCheckOutcome(outcome);
    },
  };
};
