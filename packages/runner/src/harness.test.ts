import type {
  GenerateRequest,
  GenerateResponse,
  Provider,
  StreamEvent,
  Tool,
  ToolSchema,
} from "@mg/core";
import { defineTool } from "@mg/core";
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
      { content: "hi", toolCalls: [], finishReason: "stop" },
    ]);
    const config: RunConfig = {
      name: "example",
      provider,
      harness: { kind: "loop", model: "m", maxTurns: 1, stream: false },
    };

    const harness = createHarness(config);
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
      { content: "hi", toolCalls: [], finishReason: "stop" },
    ]);
    const config: RunConfig = {
      name: "example",
      provider,
      harness: { kind: "loop", model: "m", maxTurns: 1, stream: false },
      tools: [tool],
    };

    await collect(createHarness(config)({ messages: [] }));

    const request = (
      provider.generate as unknown as {
        mock: { calls: [GenerateRequest][] };
      }
    ).mock.calls[0]?.[0];
    expect(request?.tools).toEqual([tool]);
  });

  test("unknown harness kind throws RangeError", () => {
    const provider = stubProvider([]);
    const config = {
      name: "example",
      provider,
      harness: { kind: "unknown" },
    } as unknown as RunConfig;

    expect(() => createHarness(config)).toThrow(RangeError);
  });
});
