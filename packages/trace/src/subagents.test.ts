import type { ToolCall, ToolSchema } from "@mg/core";
import {
  SubagentInputError,
  SubagentNotFoundError,
  type Subagent,
  type TraceSpan,
} from "@mg/harness";
import { describe, expect, it } from "vitest";
import { RecordingSpan } from "./recording-span.test-helper.js";
import { traceRunSubagentCall } from "./subagents.js";
import { ATTR, SPAN } from "./vocabulary.js";

const promptSchema = {
  "~standard": {
    version: 1,
    vendor: "mg-test",
    validate: (value: unknown) => {
      const prompt = (value as { prompt?: unknown } | undefined)
        ?.prompt;
      if (typeof prompt !== "string") {
        return {
          issues: [{ message: "Expected string", path: ["prompt"] }],
        };
      }
      return { value: { prompt } };
    },
    jsonSchema: {
      input: () => ({ type: "object" }),
      output: () => ({ type: "object" }),
    },
  },
} as const satisfies ToolSchema;

const stubResearcher = (
  start: Subagent<typeof promptSchema>["start"],
): Subagent<typeof promptSchema> => ({
  name: "researcher",
  description: "looks things up",
  input: promptSchema,
  start,
});

const call: ToolCall = {
  id: "c1",
  name: "researcher",
  arguments: { prompt: "x" },
};

class OrderRecordingSpan implements TraceSpan {
  constructor(
    private readonly spanName: string,
    private readonly log: string[],
  ) {}

  startSpan(name: string): TraceSpan {
    return new OrderRecordingSpan(name, this.log);
  }

  startRoot(name: string): TraceSpan {
    return new OrderRecordingSpan(name, this.log);
  }

  setAttributes(): void {}

  addEvent(): void {}

  end(): void {
    this.log.push(this.spanName);
  }
}

describe("traceRunSubagentCall", () => {
  it("records the call under the parent span with the thread id from start", async () => {
    const p = new RecordingSpan("root");
    const researcher = stubResearcher(async () => "done");

    const message = await traceRunSubagentCall(p, {
      newThreadId: () => "t1",
    })([researcher], call);

    expect(message).toEqual({
      role: "tool",
      toolCallId: "c1",
      content: "done",
    });
    expect(p.children).toHaveLength(1);
    const span = p.children[0];
    expect(span.name).toBe(SPAN.subagent);
    expect(span.mergedAttributes).toEqual({
      [ATTR.op]: "subagent",
      [ATTR.subagentName]: "researcher",
      [ATTR.subagentCallId]: "c1",
      [ATTR.subagentArguments]: JSON.stringify({ prompt: "x" }),
      [ATTR.subagentResult]: "done",
      [ATTR.threadId]: "t1",
    });
    expect(span.endCalls).toEqual([undefined]);
  });

  it("records a new root as the thread span, and creates no other children or roots", async () => {
    const p = new RecordingSpan("root");
    const researcher = stubResearcher(async () => "done");

    await traceRunSubagentCall(p, { newThreadId: () => "t1" })(
      [researcher],
      call,
    );

    const span = p.children[0];
    expect(span.roots).toHaveLength(1);
    const thread = span.roots[0];
    expect(thread.name).toBe(SPAN.thread);
    expect(thread.mergedAttributes).toEqual({
      [ATTR.op]: "thread",
      [ATTR.threadId]: "t1",
      [ATTR.subagentName]: "researcher",
    });
    expect(thread.endCalls).toEqual([undefined]);
    expect(p.roots).toHaveLength(0);
    expect(span.children).toHaveLength(0);
  });

  it("passes the thread span as the context span start receives", async () => {
    const p = new RecordingSpan("root");
    let receivedTrace: TraceSpan | undefined;
    const researcher = stubResearcher(async (_input, context) => {
      receivedTrace = context.trace;
      return "done";
    });

    await traceRunSubagentCall(p, { newThreadId: () => "t1" })(
      [researcher],
      call,
    );

    const thread = p.children[0].roots[0];
    expect(receivedTrace).toBe(thread);
  });

  it("ends both spans with the same error start throws, and rethrows it", async () => {
    const p = new RecordingSpan("root");
    const thrown = new Error("boom");
    const researcher = stubResearcher(async () => {
      throw thrown;
    });

    await expect(
      traceRunSubagentCall(p, { newThreadId: () => "t1" })(
        [researcher],
        call,
      ),
    ).rejects.toBe(thrown);

    const span = p.children[0];
    const thread = span.roots[0];
    expect(thread.endCalls).toEqual([thrown]);
    expect(span.endCalls).toEqual([thrown]);
  });

  it("creates no thread and ends the call span with the error on invalid arguments", async () => {
    const p = new RecordingSpan("root");
    const researcher = stubResearcher(async () => "done");
    const invalidCall: ToolCall = {
      id: "c1",
      name: "researcher",
      arguments: { prompt: 1 },
    };

    const error = await traceRunSubagentCall(p)(
      [researcher],
      invalidCall,
    ).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(SubagentInputError);
    const span = p.children[0];
    expect(span.roots).toHaveLength(0);
    expect(span.endCalls).toEqual([error]);
    expect(span.mergedAttributes[ATTR.threadId]).toBeUndefined();
  });

  it("creates no thread when no subagent has the called name", async () => {
    const p = new RecordingSpan("root");
    const missingCall: ToolCall = {
      id: "c1",
      name: "missing",
      arguments: {},
    };

    const error = await traceRunSubagentCall(p)([], missingCall).catch(
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(SubagentNotFoundError);
    const span = p.children[0];
    expect(span.roots).toHaveLength(0);
  });

  it("ends the thread span before the call span", async () => {
    const log: string[] = [];
    const root = new OrderRecordingSpan("root", log);
    const researcher = stubResearcher(async () => "done");

    await traceRunSubagentCall(root, { newThreadId: () => "t1" })(
      [researcher],
      call,
    );

    expect(log).toEqual([SPAN.thread, SPAN.subagent]);
  });

  it("gives each call its own thread id", async () => {
    const p = new RecordingSpan("root");
    const researcher = stubResearcher(async () => "done");
    let count = 0;
    const newThreadId = () => (count++ === 0 ? "t1" : "t2");
    const run = traceRunSubagentCall(p, { newThreadId });

    await run([researcher], call);
    await run([researcher], call);

    const [first, second] = p.children;
    expect(first.mergedAttributes[ATTR.threadId]).toBe("t1");
    expect(first.roots[0].mergedAttributes[ATTR.threadId]).toBe("t1");
    expect(second.mergedAttributes[ATTR.threadId]).toBe("t2");
    expect(second.roots[0].mergedAttributes[ATTR.threadId]).toBe("t2");
  });
});
