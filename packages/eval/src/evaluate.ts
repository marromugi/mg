import type { SessionTree } from "@mg/trace/store";
import type {
  CaseVerdict,
  Check,
  CheckResult,
  EvalContext,
} from "./types.js";
import { viewRun } from "./view.js";

const isAbortError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  (error as { name?: unknown }).name === "AbortError";

export const evaluate = async (
  session: SessionTree,
  checks: readonly Check[],
  context?: EvalContext,
): Promise<CaseVerdict> => {
  context?.signal?.throwIfAborted();

  const view = viewRun(session);

  const results: CheckResult[] = [];

  for (const check of checks) {
    context?.signal?.throwIfAborted();

    try {
      const outcome = await check.evaluate({ session, view }, context);
      const { passed, ...rest } = outcome;
      results.push({
        name: check.name,
        status: passed ? "passed" : "failed",
        ...rest,
      });
    } catch (error) {
      if (isAbortError(error) || context?.signal?.aborted === true) {
        throw error;
      }
      results.push({
        name: check.name,
        status: "error",
        message: error instanceof Error ? error.message : String(error),
        error,
      });
    }
  }

  return {
    sessionId: session.sessionId,
    passed: results.every((result) => result.status === "passed"),
    checks: results,
  };
};
