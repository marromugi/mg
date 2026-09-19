import type {
  GenerateRequest,
  GenerateResponse,
  Provider,
  StreamEvent,
  Tool,
  ToolCall,
  ToolSchema,
} from "@mg/core";
import { defineTool } from "@mg/core";
import type { Gate, Verdict } from "@mg/gate";
import { collect } from "@mg/harness";
import { describe, expect, test, vi } from "vitest";
import type { RunConfig } from "./config.js";
import { createHarness } from "./harness.js";

const stubSchema = (): ToolSchema => ({
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

const stubProvider = (
  responses: readonly GenerateResponse[],
): Provider => {
  let index = 0;
  const generate = vi.fn(async (): Promise<GenerateResponse> => {
    const response = responses[index];
    index++;
    if (!response)
      throw new Error("stubProvider: no scripted response left");
    return response;
  });
  const stream = vi.fn((): AsyncIterable<StreamEvent> => {
    throw new Error("stubProvider: stream is not scripted");
  });
  return { generate, stream };
};

describe("createHarness", () => {
  test("loop config yields a done event from one collect", async () => {
    const provider = stubProvider([
      { parts: [{ type: "text", text: "hi" }], finishReason: "stop" },
    ]);
    const config: RunConfig = {
      name: "example",
      provider,
      harness: { kind: "loop", model: "m", maxTurns: 1, stream: false },
    };

    const harness = createHarness(config, config.tools ?? []);
    const result = await collect(harness({ messages: [] }));

    expect(result.reason).toBe("stop");
  });

  test("tools are passed through to the provider's request", async () => {
    const tool: Tool = defineTool({
      name: "a",
      input: stubSchema(),
      execute: async () => "a-result",
    });
    const provider = stubProvider([
      { parts: [{ type: "text", text: "hi" }], finishReason: "stop" },
    ]);
    const config: RunConfig = {
      name: "example",
      provider,
      harness: { kind: "loop", model: "m", maxTurns: 1, stream: false },
      tools: [tool],
    };

    await collect(
      createHarness(config, config.tools ?? [])({ messages: [] }),
    );

    const request = (
      provider.generate as unknown as {
        mock: { calls: [GenerateRequest][] };
      }
    ).mock.calls[0]?.[0];
    expect(request?.tools).toEqual([tool]);
  });

  test("a config with gate builds a harness whose tool calls go through that gate", async () => {
    const toolCall: ToolCall = {
      id: "call-1",
      name: "a",
      arguments: {},
    };
    const execute = vi.fn(async () => "a-result");
    const tool: Tool = defineTool({
      name: "a",
      input: stubSchema(),
      execute,
    });
    const provider = stubProvider([
      {
        parts: [{ type: "tool-call", ...toolCall }],
        finishReason: "tool_calls",
      },
    ]);
    const judge = vi.fn(async (): Promise<Verdict> => ({
      allowed: false,
      reason: "no",
    }));
    const gate: Gate = { judge };
    const config: RunConfig = {
      name: "example",
      provider,
      harness: { kind: "loop", model: "m", maxTurns: 1, stream: false },
      tools: [tool],
      gate,
    };

    const result = await collect(
      createHarness(config, config.tools ?? [])({ messages: [] }),
    );

    expect(judge).toHaveBeenCalledTimes(1);
    expect(execute).not.toHaveBeenCalled();
    expect(result.messages).toContainEqual(
      expect.objectContaining({
        role: "tool",
        toolCallId: "call-1",
        content: expect.stringContaining("[denied]"),
      }),
    );
  });

  test("unknown harness kind throws RangeError", () => {
    const provider = stubProvider([]);
    const config = {
      name: "example",
      provider,
      harness: { kind: "unknown" },
    } as unknown as RunConfig;

    expect(() => createHarness(config, [])).toThrow(RangeError);
  });
});
