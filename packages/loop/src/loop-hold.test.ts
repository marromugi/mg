import type {
  GenerateRequest,
  Provider,
  StreamEvent,
  Tool,
  ToolSchema,
} from "@mg/core";
import { defineTool } from "@mg/core";
import { collect, createHoldController } from "@mg/harness";
import type {
  HarnessEvent,
  HarnessResult,
  Subagent,
  SubagentContext,
} from "@mg/harness";
import { describe, expect, test, vi } from "vitest";
import { createLoopHarness } from "./loop.js";

const schema = (): ToolSchema => ({
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

const streamProvider = (
  turns: readonly (readonly StreamEvent[])[],
): Provider => {
  let index = 0;
  return {
    toolForcing: true,
    generate: vi.fn(async () => {
      throw new Error("generate is not scripted");
    }),
    stream: vi.fn((_request: GenerateRequest) => {
      const events = turns[index];
      index++;
      if (!events) throw new Error("no scripted turn left");
      return (async function* () {
        for (const event of events) yield event;
      })();
    }),
  };
};

const text = (delta: string): StreamEvent => ({
  type: "text-delta",
  delta,
});
const call = (name: string): StreamEvent => ({
  type: "tool-call",
  toolCall: { id: `id-${name}`, name, arguments: {} },
});
const finish = (finishReason: "stop" | "tool_calls"): StreamEvent => ({
  type: "finish",
  finishReason,
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

const wait = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

const lastParts = (result: HarnessResult): unknown => {
  const last = result.messages.at(-1);
  return last && "parts" in last ? last.parts : undefined;
};

describe("createLoopHarness while held", () => {
  test("does not call the provider until the hold is released, then ends like an unheld run", async () => {
    const provider = streamProvider([[text("done"), finish("stop")]]);
    const hold = createHoldController();
    hold.hold();
    const harness = createLoopHarness({
      provider,
      model: "m",
      maxTurns: 3,
    });

    const run = collect(
      harness({
        messages: [{ role: "user", content: "hi" }],
        hold: hold.signal,
      }),
    );
    await wait(20);

    expect(provider.stream).toHaveBeenCalledTimes(0);

    hold.release();
    const result = await run;

    expect(result.reason).toBe("stop");
    expect(lastParts(result)).toEqual([{ type: "text", text: "done" }]);
  });

  test("delivers the rest of a streaming generation but starts no tool call until release", async () => {
    const provider = streamProvider([
      [text("a"), text("b"), call("echo"), finish("tool_calls")],
      [text("done"), finish("stop")],
    ]);
    const echo = vi.fn(async () => "echoed");
    const tool: Tool = defineTool({
      name: "echo",
      input: schema(),
      async prepare() {
        return {
          reach: { kind: "any-local" },
          run: async () => echo(),
        };
      },
    });
    const hold = createHoldController();
    const harness = createLoopHarness({
      provider,
      model: "m",
      tools: [tool],
      maxTurns: 3,
    });

    const events: HarnessEvent[] = [];
    const run = (async () => {
      for await (const event of harness({
        messages: [{ role: "user", content: "hi" }],
        hold: hold.signal,
      })) {
        events.push(event);
        if (event.type === "text-delta" && event.delta === "a") {
          hold.hold();
        }
      }
    })();
    await vi.waitFor(() =>
      expect(events).toContainEqual({ type: "text-delta", delta: "b" }),
    );
    await wait(20);

    expect(events).toContainEqual({ type: "text-delta", delta: "b" });
    expect(echo).toHaveBeenCalledTimes(0);

    hold.release();
    await run;

    expect(echo).toHaveBeenCalledTimes(1);
  });

  test("finishes running tool calls but starts no next generation until release", async () => {
    const provider = streamProvider([
      [call("slow"), finish("tool_calls")],
      [text("done"), finish("stop")],
    ]);
    const started = deferred<void>();
    const finishSlow = deferred<string>();
    const tool: Tool = defineTool({
      name: "slow",
      input: schema(),
      async prepare() {
        return {
          reach: { kind: "any-local" },
          run: async () => {
            started.resolve();
            return finishSlow.promise;
          },
        };
      },
    });
    const hold = createHoldController();
    const harness = createLoopHarness({
      provider,
      model: "m",
      tools: [tool],
      maxTurns: 3,
    });

    const events: HarnessEvent[] = [];
    const run = (async () => {
      for await (const event of harness({
        messages: [{ role: "user", content: "hi" }],
        hold: hold.signal,
      })) {
        events.push(event);
      }
    })();
    await started.promise;
    hold.hold();
    finishSlow.resolve("ok");
    await vi.waitFor(() =>
      expect(events.some((e) => e.type === "tool-result")).toBe(true),
    );
    await wait(20);

    expect(events).toContainEqual({
      type: "tool-result",
      message: { role: "tool", toolCallId: "id-slow", content: "ok" },
    });
    expect(provider.stream).toHaveBeenCalledTimes(1);

    hold.release();
    await run;

    expect(provider.stream).toHaveBeenCalledTimes(2);
  });

  test("ends as wrapped-up without another provider call when wrap-up fires while waiting", async () => {
    const provider = streamProvider([
      [call("t"), finish("tool_calls")],
      [text("done"), finish("stop")],
    ]);
    const hold = createHoldController();
    const wrapUp = new AbortController();
    const tool: Tool = defineTool({
      name: "t",
      input: schema(),
      async prepare() {
        return {
          reach: { kind: "any-local" },
          run: async () => {
            hold.hold();
            return "ok";
          },
        };
      },
    });
    const harness = createLoopHarness({
      provider,
      model: "m",
      tools: [tool],
      maxTurns: 3,
    });

    const run = collect(
      harness({
        messages: [{ role: "user", content: "hi" }],
        hold: hold.signal,
        wrapUp: wrapUp.signal,
      }),
    );
    await wait(20);
    wrapUp.abort();
    const result = await run;

    expect(result.reason).toBe("wrapped-up");
    expect(provider.stream).toHaveBeenCalledTimes(1);
  });

  test("rejects with the abort reason without another provider call when the abort signal fires while waiting", async () => {
    const provider = streamProvider([
      [call("t"), finish("tool_calls")],
      [text("done"), finish("stop")],
    ]);
    const hold = createHoldController();
    const abort = new AbortController();
    const tool: Tool = defineTool({
      name: "t",
      input: schema(),
      async prepare() {
        return {
          reach: { kind: "any-local" },
          run: async () => {
            hold.hold();
            return "ok";
          },
        };
      },
    });
    const harness = createLoopHarness({
      provider,
      model: "m",
      tools: [tool],
      maxTurns: 3,
    });
    const reason = new Error("aborted by test");

    const settled = collect(
      harness({
        messages: [{ role: "user", content: "hi" }],
        hold: hold.signal,
        signal: abort.signal,
      }),
    ).then(
      () => undefined,
      (error: unknown) => error,
    );
    await wait(20);
    abort.abort(reason);

    expect(await settled).toBe(reason);
    expect(provider.stream).toHaveBeenCalledTimes(1);
  });

  test("gives a subagent the hold signal, whose held state follows the controller", async () => {
    const provider = streamProvider([
      [call("helper"), finish("tool_calls")],
      [text("done"), finish("stop")],
    ]);
    const received: { current?: SubagentContext["hold"] } = {};
    const helper: Subagent = {
      name: "helper",
      input: schema(),
      async prepare(_input) {
        return {
          reach: { kind: "any-local" },
          run: async (context) => {
            received.current = context.hold;
            return "helped";
          },
        };
      },
    };
    const hold = createHoldController();
    hold.hold();
    const harness = createLoopHarness({
      provider,
      model: "m",
      subagents: [helper],
      maxTurns: 3,
    });

    const run = collect(
      harness({
        messages: [{ role: "user", content: "hi" }],
        hold: hold.signal,
      }),
    );
    hold.release();
    await run;

    expect(received.current?.held).toBe(false);

    hold.hold();

    expect(received.current?.held).toBe(true);
  });
});
