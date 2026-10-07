import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { Estimator } from "@mg/core";
import type { HarnessEvent } from "@mg/harness";
import { run as realRun, type RunEntry } from "@mg/runner";
import { assemble } from "../assemble/index.js";
import type { HarnessDefinition } from "../definition/index.js";
import type { SecretName, SecretStore } from "../secret-store/index.js";
import { createEventLog, type EventLog } from "./event-log.js";

export const TRACE_DIR_NAME = "traces";

export type TestRunEvent =
  | { type: "harness"; event: HarnessEvent }
  | {
      type: "ended";
      reason: string;
      usage: { inputTokens: number; outputTokens: number };
      tracePath: string;
    }
  | { type: "stopped"; tracePath: string }
  // No tracePath when the run failed before `run` was called: no trace
  // file was written.
  | { type: "failed"; message: string; tracePath?: string };

export type StartResult =
  | { ok: true; runId: string }
  | { ok: false; missingSecret: SecretName };

// Runs a saved harness on one input and keeps what happened, for as long
// as the server lives.
export interface TestRuns {
  start(
    definition: HarnessDefinition,
    input: string,
  ): Promise<StartResult>;
  // Every event of the run from its first, then the ones still to come.
  // Undefined when no run has this id.
  watch(runId: string): AsyncIterable<TestRunEvent> | undefined;
  // False when no run has this id or the run has already ended.
  stop(runId: string): boolean;
}

type RunRecord = {
  log: EventLog<TestRunEvent>;
  // `abort` ends tool calls and the run's next turn; `wrapUp` also cuts
  // the model's turn that is streaming now.
  abort: AbortController;
  wrapUp: AbortController;
  finished: boolean;
};

const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const finish = (record: RunRecord, event: TestRunEvent): void => {
  record.finished = true;
  record.log.push(event);
  record.log.close();
};

export const createTestRuns = (parts: {
  secrets: SecretStore;
  dataDir: string;
  // The estimator a harness's gate asks.
  jev?: Estimator;
  run?: RunEntry;
}): TestRuns => {
  const run = parts.run ?? realRun;
  const records = new Map<string, RunRecord>();

  const execute = async (
    record: RunRecord,
    config: Parameters<RunEntry>[0],
    input: string,
    tracePath: string,
  ): Promise<void> => {
    try {
      const { result } = await run(
        config,
        [{ role: "user", content: input }],
        {
          signal: record.abort.signal,
          wrapUp: record.wrapUp.signal,
          onEvent: (event) =>
            record.log.push({ type: "harness", event }),
        },
      );
      finish(
        record,
        result.reason === "wrapped-up"
          ? { type: "stopped", tracePath }
          : {
              type: "ended",
              reason: result.reason,
              usage: result.usage,
              tracePath,
            },
      );
    } catch (error) {
      finish(
        record,
        record.abort.signal.aborted
          ? { type: "stopped", tracePath }
          : { type: "failed", message: reasonOf(error), tracePath },
      );
    }
  };

  return {
    start: async (definition, input) => {
      const runId = randomUUID();
      const tracePath = join(
        parts.dataDir,
        TRACE_DIR_NAME,
        `${runId}.jsonl`,
      );
      const record: RunRecord = {
        log: createEventLog(),
        abort: new AbortController(),
        wrapUp: new AbortController(),
        finished: false,
      };

      let assembled: Awaited<ReturnType<typeof assemble>>;
      try {
        assembled = await assemble(definition, {
          secrets: parts.secrets,
          tracePath,
          jev: parts.jev,
        });
      } catch (error) {
        records.set(runId, record);
        finish(record, {
          type: "failed",
          message: reasonOf(error),
        });
        return { ok: true, runId };
      }
      if (!assembled.ok) return assembled;

      records.set(runId, record);
      void execute(record, assembled.config, input, tracePath);
      return { ok: true, runId };
    },

    watch: (runId) => records.get(runId)?.log.watch(),

    stop: (runId) => {
      const record = records.get(runId);
      if (record === undefined || record.finished) return false;
      record.wrapUp.abort();
      record.abort.abort();
      return true;
    },
  };
};
