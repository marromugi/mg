import type { SessionTree } from "@mg/trace/store";
import type { RunView } from "./view.js";

export type EvalInput = { session: SessionTree; view: RunView };

export type EvalContext = { signal?: AbortSignal };

export type CheckOutcome = {
  passed: boolean;
  reason: string;
  score?: number;
  threshold?: number;
  details?: unknown;
};

export interface Check {
  readonly name: string;
  evaluate(
    input: EvalInput,
    context?: EvalContext,
  ): Promise<CheckOutcome>;
}

export type CheckResult =
  | ({ name: string; status: "passed" | "failed" } & Omit<
      CheckOutcome,
      "passed"
    >)
  | { name: string; status: "error"; message: string; error: unknown };

export type CaseVerdict = {
  sessionId: string;
  passed: boolean;
  checks: CheckResult[];
};
