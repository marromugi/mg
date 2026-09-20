import type { Message } from "@mg/core";
import type { HarnessResult } from "@mg/harness";
import { exclusiveNamesOf } from "@mg/workspace";
import { nanoid } from "nanoid";
import type { RunConfig } from "./config.js";
import { run } from "./run.js";

export type RunCase = { id: string; messages: Message[] };

export type RunManyOptions = {
  signal?: AbortSignal;
  concurrency?: number;
};

export type RunManyOutcome =
  | { id: string; sessionId: string; result: HarnessResult }
  | { id: string; sessionId: string; error: unknown };

export const runMany = async (
  config: RunConfig,
  cases: readonly RunCase[],
  options?: RunManyOptions,
): Promise<RunManyOutcome[]> => {
  const concurrency = options?.concurrency ?? 1;
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError(
      `concurrency must be an integer >= 1, got ${concurrency}`,
    );
  }
  if (config.workspace !== undefined && concurrency > 1) {
    const names = exclusiveNamesOf(config.workspace);
    if (names.length > 0) {
      const nameList = names.map((name) => `"${name}"`).join(", ");
      throw new RangeError(
        `workspace "${config.workspace.name}" holds ${nameList} exclusively; concurrency must be 1, got ${concurrency}`,
      );
    }
  }

  const signal = options?.signal;
  const sessionIds = cases.map(() => nanoid());
  const outcomes: RunManyOutcome[] = Array.from({
    length: cases.length,
  });

  let nextIndex = 0;
  const worker = async () => {
    for (;;) {
      const index = nextIndex;
      nextIndex++;
      if (index >= cases.length) return;

      const runCase = cases[index];
      const sessionId = sessionIds[index];
      if (signal?.aborted) {
        outcomes[index] = {
          id: runCase.id,
          sessionId,
          error: signal.reason,
        };
        continue;
      }

      try {
        const result = await run(config, runCase.messages, {
          signal,
          sessionId,
          caseId: runCase.id,
        });
        outcomes[index] = {
          id: runCase.id,
          sessionId,
          result: result.result,
        };
      } catch (error) {
        outcomes[index] = { id: runCase.id, sessionId, error };
      }
    }
  };

  const workers = Array.from(
    { length: Math.min(concurrency, cases.length) },
    () => worker(),
  );
  await Promise.all(workers);

  return outcomes;
};
