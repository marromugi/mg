import type { GenerateResponse, Provider, ToolSchema } from "@mg/core";
import { defineTool } from "@mg/core";
import type { HarnessEvent } from "@mg/harness";
import { describe, expect, test } from "vitest";
import type { RunConfig } from "./config.js";
import { run as runWithConfig } from "./run.js";
import type { QueueRunOptions } from "./run-queue.js";
import { createRunQueue } from "./run-queue.js";

type Call = { input: string; options: QueueRunOptions };

const createFakeRun = () => {
  const calls: Call[] = [];
  const settlers = new Map<
    string,
    {
      resolve: (value: string) => void;
      reject: (error: unknown) => void;
    }
  >();

  const run = (
    input: string,
    options: QueueRunOptions,
  ): Promise<string> => {
    calls.push({ input, options });
    return new Promise<string>((resolve, reject) => {
      settlers.set(input, { resolve, reject });
    });
  };

  return {
    run,
    calls,
    resolve: (input: string, value: string) => {
      settlers.get(input)?.resolve(value);
    },
    reject: (input: string, error: unknown) => {
      settlers.get(input)?.reject(error);
    },
  };
};

const waitFor = async (
  predicate: () => boolean,
  timeoutMs = 1000,
): Promise<void> => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs)
      throw new Error("timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

describe("createRunQueue", () => {
  test("runs items one at a time in the order they were enqueued, and reports what each returned", async () => {
    const fake = createFakeRun();
    const queue = createRunQueue(fake.run);

    const a = queue.enqueue("a");
    const b = queue.enqueue("b");

    expect(fake.calls.map((call) => call.input)).toEqual(["a"]);

    fake.resolve("a", "A");
    await waitFor(() => fake.calls.length === 2);
    expect(fake.calls.map((call) => call.input)).toEqual(["a", "b"]);

    expect(await a.ending).toEqual({ kind: "finished", outcome: "A" });

    fake.resolve("b", "B");
    await b.ending;
  });

  test("returns a 21-character id at enqueue time that the run function receives as sessionId", async () => {
    const fake = createFakeRun();
    const queue = createRunQueue(fake.run);

    const a = queue.enqueue("a");
    await waitFor(() => fake.calls.length === 1);
    const b = queue.enqueue("b");

    expect(a.id).toMatch(/^[A-Za-z0-9_-]{21}$/);
    expect(b.id).toMatch(/^[A-Za-z0-9_-]{21}$/);
    expect(a.id).not.toBe(b.id);
    expect(fake.calls[0]?.options.sessionId).toBe(a.id);

    fake.resolve("a", "A");
    await a.ending;
    await waitFor(() => fake.calls.length === 2);
    expect(fake.calls[1]?.options.sessionId).toBe(b.id);
    fake.resolve("b", "B");
    await b.ending;
  });

  test("enqueueing at the front starts after the running item but before other waiting items", async () => {
    const fake = createFakeRun();
    const queue = createRunQueue(fake.run);

    const a = queue.enqueue("a");
    await waitFor(() => fake.calls.length === 1);
    queue.enqueue("b");
    queue.enqueue("c");
    queue.enqueue("d", { first: true });

    fake.resolve("a", "A");
    await a.ending;
    await waitFor(() => fake.calls.length === 2);

    fake.resolve("d", "D");
    await waitFor(() => fake.calls.length === 3);

    fake.resolve("b", "B");
    await waitFor(() => fake.calls.length === 4);

    fake.resolve("c", "C");

    expect(fake.calls.map((call) => call.input)).toEqual([
      "a",
      "d",
      "b",
      "c",
    ]);
  });

  test("wrapUp aborts only the signal of the item currently running", async () => {
    const fake = createFakeRun();
    const queue = createRunQueue(fake.run);

    const a = queue.enqueue("a");
    await waitFor(() => fake.calls.length === 1);
    queue.enqueue("b");

    expect(queue.wrapUp()).toBe(true);
    expect(fake.calls[0]?.options.wrapUp.aborted).toBe(true);

    fake.resolve("a", "A");
    await a.ending;
    await waitFor(() => fake.calls.length === 2);

    expect(fake.calls[1]?.options.wrapUp.aborted).toBe(false);
    fake.resolve("b", "B");
  });

  test("wrapUp on an empty queue does nothing and returns false", async () => {
    const fake = createFakeRun();
    const queue = createRunQueue(fake.run);

    expect(queue.wrapUp()).toBe(false);

    const a = queue.enqueue("a");
    await waitFor(() => fake.calls.length === 1);
    expect(fake.calls[0]?.options.wrapUp.aborted).toBe(false);
    fake.resolve("a", "A");
    await a.ending;
  });

  test("an item whose run function throws or rejects ends as failed, and the queue moves on", async () => {
    const fake = createFakeRun();
    const queue = createRunQueue(fake.run);
    const error = new Error("x");

    const a = queue.enqueue("a");
    await waitFor(() => fake.calls.length === 1);
    const b = queue.enqueue("b");

    fake.reject("a", error);
    const ending = await a.ending;
    expect(ending.kind).toBe("failed");
    expect(ending.kind === "failed" && ending.error).toBe(error);

    await waitFor(() => fake.calls.length === 2);
    fake.resolve("b", "B");
    await b.ending;
  });

  test("close ends waiting items as dropped without calling run, and resolves once the running item ends", async () => {
    const fake = createFakeRun();
    const queue = createRunQueue(fake.run);

    const a = queue.enqueue("a");
    await waitFor(() => fake.calls.length === 1);
    const b = queue.enqueue("b");

    let closeResolved = false;
    const closing = queue.close().then(() => {
      closeResolved = true;
    });

    expect(await b.ending).toEqual({
      kind: "dropped",
      reason: "closed",
    });
    expect(fake.calls.map((call) => call.input)).toEqual(["a"]);
    expect(closeResolved).toBe(false);

    fake.resolve("a", "A");
    await closing;
    expect(closeResolved).toBe(true);
    expect(await a.ending).toEqual({ kind: "finished", outcome: "A" });
  });

  test("enqueueing after close returns an id and ends as dropped without calling run", async () => {
    const fake = createFakeRun();
    const queue = createRunQueue(fake.run);
    await queue.close();

    const z = queue.enqueue("z");

    expect(await z.ending).toEqual({
      kind: "dropped",
      reason: "closed",
    });
    expect(fake.calls).toEqual([]);
  });

  test("calls onStart with the id before events reach onEvent with the id", async () => {
    const log: string[] = [];
    const event: HarnessEvent = { type: "text-delta", delta: "x" };

    const run = (
      _input: string,
      options: QueueRunOptions,
    ): Promise<string> => {
      options.onEvent(event);
      return new Promise(() => {
        // never resolves; the case only checks call order.
      });
    };

    const queue = createRunQueue(run, {
      onStart: (id) => log.push(`start(${id})`),
      onEvent: (id, receivedEvent) =>
        log.push(`event(${id}, ${JSON.stringify(receivedEvent)})`),
    });

    const { id } = queue.enqueue("a");
    await waitFor(() => log.length === 2);

    expect(log).toEqual([
      `start(${id})`,
      `event(${id}, ${JSON.stringify(event)})`,
    ]);
  });

  test("an item ends as failed without calling run when onStart throws", async () => {
    const fake = createFakeRun();
    const error = new Error("s");
    const queue = createRunQueue(fake.run, {
      onStart: () => {
        throw error;
      },
    });

    const a = queue.enqueue("a");
    const ending = await a.ending;

    expect(ending.kind).toBe("failed");
    expect(ending.kind === "failed" && ending.error).toBe(error);
    expect(fake.calls).toEqual([]);
  });

  test("an error thrown by onEvent is thrown back into the call the run function made", async () => {
    const error = new Error("e");
    const event: HarnessEvent = { type: "text-delta", delta: "x" };
    let caught: unknown;

    const run = (
      _input: string,
      options: QueueRunOptions,
    ): Promise<string> => {
      try {
        options.onEvent(event);
      } catch (thrown) {
        caught = thrown;
      }
      return Promise.resolve("done");
    };

    const queue = createRunQueue(run, {
      onEvent: () => {
        throw error;
      },
    });

    const a = queue.enqueue("a");
    await a.ending;

    expect(caught).toBe(error);
  });
});

const noopSchema = (): ToolSchema => ({
  "~standard": {
    version: 1,
    vendor: "mg-test",
    validate: (value: unknown) => ({ value }),
    jsonSchema: {
      input: () => ({ type: "object" }),
      output: () => ({ type: "object" }),
    },
  },
});

const scriptedProvider = (
  responses: readonly GenerateResponse[],
): { provider: Provider; calls: () => number } => {
  let index = 0;
  return {
    provider: {
      toolForcing: true,
      generate: async () => {
        const response = responses[index % responses.length];
        index++;
        if (!response) throw new Error("no scripted response");
        return response;
      },
      stream: () => {
        throw new Error("stream is not scripted");
      },
    },
    calls: () => index,
  };
};

const settle = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 20));

describe("createRunQueue with a hold", () => {
  test("holds a running item before its next turn, and the item finishes after release", async () => {
    const { provider, calls } = scriptedProvider([
      {
        parts: [
          {
            type: "tool-call",
            id: "c1",
            name: "noop",
            arguments: {},
          },
        ],
        finishReason: "tool_calls",
      },
      {
        parts: [{ type: "text", text: "done" }],
        finishReason: "stop",
      },
    ]);
    const config: RunConfig = {
      name: "example",
      provider,
      harness: { kind: "loop", model: "m", maxTurns: 2, stream: false },
      gate: { judge: async () => ({ allowed: true, reason: "ok" }) },
      tools: [
        defineTool({
          reach: async () => ({ kind: "any-local" }),
          name: "noop",
          input: noopSchema(),
          execute: async () => "ok",
        }),
      ],
    };
    const queue = createRunQueue<string, unknown>(
      (input, options) =>
        runWithConfig(
          config,
          [{ role: "user", content: input }],
          options,
        ),
      {
        onEvent: (_id, event) => {
          if (event.type === "turn") queue.hold();
        },
      },
    );

    const item = queue.enqueue("go");
    await settle();
    expect(calls()).toBe(1);

    queue.release();
    expect((await item.ending).kind).toBe("finished");
  });

  test("holds items enqueued while held, across runs, until released", async () => {
    const { provider, calls } = scriptedProvider([
      {
        parts: [{ type: "text", text: "done" }],
        finishReason: "stop",
      },
    ]);
    const config: RunConfig = {
      name: "example",
      provider,
      harness: { kind: "loop", model: "m", maxTurns: 1, stream: false },
    };
    const queue = createRunQueue<string, unknown>((input, options) =>
      runWithConfig(
        config,
        [{ role: "user", content: input }],
        options,
      ),
    );

    queue.hold();
    const first = queue.enqueue("a");
    const second = queue.enqueue("b");
    await settle();
    expect(calls()).toBe(0);

    queue.release();
    expect((await first.ending).kind).toBe("finished");
    expect((await second.ending).kind).toBe("finished");
    expect(calls()).toBe(2);

    queue.hold();
    const third = queue.enqueue("c");
    await settle();
    expect(calls()).toBe(2);

    queue.release();
    expect((await third.ending).kind).toBe("finished");
  });
});
