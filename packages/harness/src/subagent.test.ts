import type { ToolCall, ToolSchema } from "@mg/core";
import { describe, expect, test, vi } from "vitest";
import { runSubagentCall, type Subagent } from "./subagent.js";
import {
  SubagentInputError,
  SubagentNotFoundError,
} from "./subagent-errors.js";
import type { TraceSpan } from "./trace.js";
import { noopSpan } from "./trace.js";

type Prompt = { prompt: string };

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
    // 型だけを固定する断定なので、消すと下の型のテストが崩れます。
    // oxlint-disable-next-line typescript/no-unnecessary-type-assertion
    types: undefined as unknown as { input: Prompt; output: Prompt },
  },
} as const satisfies ToolSchema;

const stubResearcher = (
  start: Subagent<typeof promptSchema>["start"],
): Subagent<typeof promptSchema> => ({
  name: "researcher",
  input: promptSchema,
  start: vi.fn(start),
});

describe("runSubagentCall", () => {
  test("starts the matching subagent and returns a tool message", async () => {
    const received: {
      input?: { prompt: string };
      context?: { signal?: AbortSignal; trace?: TraceSpan };
    } = {};
    const researcher = stubResearcher(async (input, context) => {
      received.input = input;
      received.context = context;
      return "done";
    });
    const controller = new AbortController();
    const trace = noopSpan;
    const call: ToolCall = {
      id: "c1",
      name: "researcher",
      arguments: { prompt: "find x" },
    };

    await expect(
      runSubagentCall([researcher], call, {
        signal: controller.signal,
        trace,
      }),
    ).resolves.toEqual({
      role: "tool",
      toolCallId: "c1",
      content: "done",
    });
    expect(received.input).toEqual({ prompt: "find x" });
    expect(received.context?.signal).toBe(controller.signal);
    expect(received.context?.trace).toBe(trace);
  });

  test("throws SubagentNotFoundError when no subagent has the name", async () => {
    const call: ToolCall = { id: "c1", name: "missing", arguments: {} };

    const error = await runSubagentCall([], call).catch(
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(SubagentNotFoundError);
    expect((error as SubagentNotFoundError).name).toBe(
      "SubagentNotFoundError",
    );
    expect((error as SubagentNotFoundError).message).toBe(
      "No subagent named missing for call c1",
    );
  });

  test("throws SubagentInputError with the issues and skips start", async () => {
    const researcher = stubResearcher(async () => "done");
    const call: ToolCall = {
      id: "c1",
      name: "researcher",
      arguments: { prompt: 1 },
    };

    const error = await runSubagentCall([researcher], call).catch(
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(SubagentInputError);
    expect((error as SubagentInputError).name).toBe(
      "SubagentInputError",
    );
    expect((error as SubagentInputError).message).toBe(
      "Invalid arguments for subagent call c1 (researcher)",
    );
    expect(
      (error as SubagentInputError).issues.length,
    ).toBeGreaterThanOrEqual(1);
    expect(researcher.start).not.toHaveBeenCalled();
  });

  test("lets an error thrown by start through unchanged", async () => {
    const thrown = new Error("boom");
    const researcher = stubResearcher(async () => {
      throw thrown;
    });
    const call: ToolCall = {
      id: "c1",
      name: "researcher",
      arguments: { prompt: "find x" },
    };

    await expect(runSubagentCall([researcher], call)).rejects.toBe(
      thrown,
    );
  });

  test("passes an empty context when none is given", async () => {
    const received: { context?: unknown } = {};
    const researcher = stubResearcher(async (_input, context) => {
      received.context = context;
      return "done";
    });
    const call: ToolCall = {
      id: "c1",
      name: "researcher",
      arguments: { prompt: "find x" },
    };

    await runSubagentCall([researcher], call);

    expect(received.context).toEqual({});
  });
});
