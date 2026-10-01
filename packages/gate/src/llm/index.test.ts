import {
  createOllamaProvider,
  createOpenRouterProvider,
  ProviderResponseError,
} from "@mg/core";
import type {
  GenerateRequest,
  GenerateResponse,
  StreamEvent,
  ToolForcingProvider,
} from "@mg/core";
import type { TraceAttributes, TraceSpan } from "@mg/harness";
import { ATTR, SPAN } from "@mg/trace";
import { describe, expect, expectTypeOf, test, vi } from "vitest";
import { GateError } from "../errors.js";
import type { GateContext, GateRequest } from "../types.js";
import { createLlmGate } from "./index.js";
import type { LlmGateOptions } from "./index.js";

class RecordingSpan implements TraceSpan {
  readonly name: string;
  readonly attributes: TraceAttributes;
  readonly children: RecordingSpan[] = [];

  constructor(name: string, attributes?: TraceAttributes) {
    this.name = name;
    this.attributes = attributes ?? {};
  }

  startSpan(name: string, attributes?: TraceAttributes): TraceSpan {
    const child = new RecordingSpan(name, attributes);
    this.children.push(child);
    return child;
  }

  startRoot(name: string, attributes?: TraceAttributes): TraceSpan {
    return this.startSpan(name, attributes);
  }

  setAttributes(): void {}

  addEvent(): void {}

  end(): void {}
}

const stubProvider = (
  respond: (request: GenerateRequest) => GenerateResponse,
): ToolForcingProvider => {
  const generate = vi.fn(
    async (request: GenerateRequest): Promise<GenerateResponse> =>
      respond(request),
  );
  const stream = vi.fn((): AsyncIterable<StreamEvent> => {
    throw new Error("stubProvider: stream is not scripted");
  });
  return { toolForcing: true, generate, stream };
};

const verdictResponse = (
  args: Record<string, unknown>,
): GenerateResponse => ({
  parts: [
    {
      type: "tool-call",
      id: "call-1",
      name: "verdict",
      arguments: args,
    },
  ],
  finishReason: "tool_calls",
});

const request: GateRequest = {
  kind: "tool-call",
  description: "Runs `bash` with command: echo hi",
};

describe("createLlmGate", () => {
  test("allowed: true becomes a matching Verdict", async () => {
    const provider = stubProvider(() =>
      verdictResponse({ allowed: true, reason: "matches the policy" }),
    );
    const gate = createLlmGate({
      provider,
      model: "m",
      instruction: "Allow read-only commands.",
    });

    await expect(gate.judge(request)).resolves.toEqual({
      allowed: true,
      reason: "matches the policy",
    });
  });

  test("allowed: false becomes a matching Verdict", async () => {
    const provider = stubProvider(() =>
      verdictResponse({ allowed: false, reason: "writes to disk" }),
    );
    const gate = createLlmGate({
      provider,
      model: "m",
      instruction: "Allow read-only commands.",
    });

    await expect(gate.judge(request)).resolves.toEqual({
      allowed: false,
      reason: "writes to disk",
    });
  });

  test("sends the instruction as the whole system message and the kind and description in user", async () => {
    let seen: GenerateRequest | undefined;
    const provider = stubProvider((generateRequest) => {
      seen = generateRequest;
      return verdictResponse({ allowed: true, reason: "ok" });
    });
    const gate = createLlmGate({
      provider,
      model: "m",
      instruction: "Allow read-only commands.",
    });

    await gate.judge(request);

    if (seen === undefined) throw new Error("request not captured");

    expect(seen.messages[0]).toEqual({
      role: "system",
      content: "Allow read-only commands.",
    });
    expect(seen.messages[1]).toEqual({
      role: "user",
      content: `Kind: tool-call\n${request.description}`,
    });
  });

  test("forces the verdict tool via toolChoice", async () => {
    let seen: GenerateRequest | undefined;
    const provider = stubProvider((generateRequest) => {
      seen = generateRequest;
      return verdictResponse({ allowed: true, reason: "ok" });
    });
    const gate = createLlmGate({
      provider,
      model: "m",
      instruction: "policy",
    });

    await gate.judge(request);

    expect(seen?.toolChoice).toEqual({ type: "tool", name: "verdict" });
  });

  test("throws GateError when no toolCalls are returned", async () => {
    const provider = stubProvider(() => ({
      parts: [{ type: "text", text: "no tools called" }],
      finishReason: "stop",
    }));
    const gate = createLlmGate({
      provider,
      model: "m",
      instruction: "policy",
    });

    await expect(gate.judge(request)).rejects.toBeInstanceOf(GateError);
  });

  test("throws GateError when the verdict arguments fail validation", async () => {
    const provider = stubProvider(() =>
      verdictResponse({ allowed: "yes", reason: 1 }),
    );
    const gate = createLlmGate({
      provider,
      model: "m",
      instruction: "policy",
    });

    await expect(gate.judge(request)).rejects.toBeInstanceOf(GateError);
  });

  test("wraps a provider error in GateError with the original as cause", async () => {
    const original = new Error("provider down");
    const generate = vi.fn(async () => {
      throw original;
    });
    const stream = vi.fn((): AsyncIterable<StreamEvent> => {
      throw new Error("stubProvider: stream is not scripted");
    });
    const provider: ToolForcingProvider = {
      toolForcing: true,
      generate,
      stream,
    };
    const gate = createLlmGate({
      provider,
      model: "m",
      instruction: "policy",
    });

    const error = await gate
      .judge(request)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(GateError);
    expect((error as GateError).message).toBe("Gate judgement failed");
    expect((error as GateError).callerMessage).toBe(
      "Gate judgement failed",
    );
    expect((error as GateError).cause).toBe(original);
  });

  test("states the provider's reason in message and leaves the service text out of callerMessage", async () => {
    const original = new ProviderResponseError(
      "Provider response is not JSON",
      {
        cause: new SyntaxError("Unexpected token '<'"),
        causeQuotesService: true,
      },
    );
    const provider: ToolForcingProvider = {
      toolForcing: true,
      generate: vi.fn(async () => {
        throw original;
      }),
      stream: vi.fn((): AsyncIterable<StreamEvent> => {
        throw new Error("stubProvider: stream is not scripted");
      }),
    };
    const gate = createLlmGate({
      provider,
      model: "m",
      instruction: "policy",
    });

    const error = await gate
      .judge(request)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(GateError);
    expect((error as GateError).message).toBe(
      "Gate judgement failed: Provider response is not JSON: Unexpected token '<'",
    );
    expect((error as GateError).callerMessage).toBe(
      "Gate judgement failed: Provider response is not JSON: (text from the service left out)",
    );
    expect((error as GateError).cause).toBe(original);
  });

  test("lets an AbortError from the provider through unchanged", async () => {
    const abortError = new DOMException("aborted", "AbortError");
    const generate = vi.fn(async () => {
      throw abortError;
    });
    const stream = vi.fn((): AsyncIterable<StreamEvent> => {
      throw new Error("stubProvider: stream is not scripted");
    });
    const provider: ToolForcingProvider = {
      toolForcing: true,
      generate,
      stream,
    };
    const gate = createLlmGate({
      provider,
      model: "m",
      instruction: "policy",
    });

    await expect(gate.judge(request)).rejects.toBe(abortError);
  });

  test("lets a plain object shaped like an AbortError through unchanged", async () => {
    const abortError = { name: "AbortError" };
    const generate = vi.fn(async () => {
      throw abortError;
    });
    const stream = vi.fn((): AsyncIterable<StreamEvent> => {
      throw new Error("stubProvider: stream is not scripted");
    });
    const provider: ToolForcingProvider = {
      toolForcing: true,
      generate,
      stream,
    };
    const gate = createLlmGate({
      provider,
      model: "m",
      instruction: "policy",
    });

    await expect(gate.judge(request)).rejects.toBe(abortError);
  });

  test("rejects with the abort reason while the provider call is running, once the signal fires", async () => {
    const controller = new AbortController();
    const provider: ToolForcingProvider = {
      toolForcing: true,
      generate: vi.fn(
        (sent: GenerateRequest): Promise<GenerateResponse> =>
          new Promise((resolve) => {
            sent.halt?.addEventListener("abort", () =>
              resolve({ parts: [], finishReason: "halted" }),
            );
          }),
      ),
      stream: vi.fn((): AsyncIterable<StreamEvent> => {
        throw new Error("stubProvider: stream is not scripted");
      }),
    };
    const gate = createLlmGate({
      provider,
      model: "m",
      instruction: "policy",
    });

    const pending = gate
      .judge(request, {
        signal: controller.signal,
      })
      .catch((error: unknown) => error);
    controller.abort("stopped");

    expect(await pending).toBe("stopped");
  });

  test("sends no halt when the context has no signal", async () => {
    let seen: GenerateRequest | undefined;
    const provider = stubProvider((req) => {
      seen = req;
      return verdictResponse({ allowed: true, reason: "ok" });
    });
    const gate = createLlmGate({
      provider,
      model: "m",
      instruction: "policy",
    });

    await gate.judge(request);

    expect(seen?.halt).toBeUndefined();
  });

  test("sends the instruction exactly as given, surrounding whitespace included", async () => {
    let seen: GenerateRequest | undefined;
    const provider = stubProvider((generateRequest) => {
      seen = generateRequest;
      return verdictResponse({ allowed: true, reason: "ok" });
    });
    const gate = createLlmGate({
      provider,
      model: "m",
      instruction: "\n  Judge it.  \n",
    });

    await gate.judge(request);

    expect(seen?.messages[0]).toEqual({
      role: "system",
      content: "\n  Judge it.  \n",
    });
  });

  test("throws RangeError when the instruction is empty or whitespace only", () => {
    const provider = stubProvider(() =>
      verdictResponse({ allowed: true, reason: "ok" }),
    );

    expect(() =>
      createLlmGate({ provider, model: "m", instruction: "" }),
    ).toThrow(new RangeError("instruction must not be empty"));
    expect(() =>
      createLlmGate({ provider, model: "m", instruction: " \n\t" }),
    ).toThrow(new RangeError("instruction must not be empty"));
  });

  test("rejects with AbortError without calling the provider when the signal is already aborted", async () => {
    const provider = stubProvider(() =>
      verdictResponse({ allowed: true, reason: "ok" }),
    );
    const gate = createLlmGate({
      provider,
      model: "m",
      instruction: "policy",
    });
    const controller = new AbortController();
    controller.abort();

    const error = await gate
      .judge(request, { signal: controller.signal })
      .catch((thrown: unknown) => thrown);

    expect(error).toMatchObject({ name: "AbortError" });
    expect(provider.generate).not.toHaveBeenCalled();
  });

  test("records mg.gate with mg.llm nested inside, model attribute included", async () => {
    const provider = stubProvider(() =>
      verdictResponse({ allowed: true, reason: "ok" }),
    );
    const gate = createLlmGate({
      provider,
      model: "m",
      instruction: "policy",
    });
    const root = new RecordingSpan("root");
    const context: GateContext = { trace: root };

    await gate.judge(request, context);

    expect(root.children).toHaveLength(1);
    const gateSpan = root.children[0];
    expect(gateSpan.name).toBe(SPAN.gate);
    expect(gateSpan.attributes[ATTR.gateModel]).toBe("m");

    expect(gateSpan.children).toHaveLength(1);
    const llmSpan = gateSpan.children[0];
    expect(llmSpan.name).toBe(SPAN.llm);
    expect(llmSpan.attributes[ATTR.llmModel]).toBe("m");
  });

  test("does not record a span and calls the provider directly when context has no trace", async () => {
    const provider = stubProvider(() =>
      verdictResponse({ allowed: true, reason: "ok" }),
    );
    const gate = createLlmGate({
      provider,
      model: "m",
      instruction: "policy",
    });

    await expect(gate.judge(request)).resolves.toEqual({
      allowed: true,
      reason: "ok",
    });

    expect(provider.generate).toHaveBeenCalledTimes(1);
  });
});

describe("createLlmGate options type", () => {
  test("requires an instruction and has no policy option", () => {
    type Options = LlmGateOptions;
    type NoInstruction = {
      provider: ToolForcingProvider;
      model: string;
    };

    // @ts-expect-error policy is not an option
    expectTypeOf<Options>().toHaveProperty("policy");
    // @ts-expect-error instruction is required
    expectTypeOf<NoInstruction>().toMatchTypeOf<Options>();

    expect(true).toBe(true);
  });
});

describe("createLlmGate provider type", () => {
  test("refuses a provider that cannot force a tool call", () => {
    const refused = createLlmGate({
      // @ts-expect-error the Ollama provider cannot force a tool call
      provider: createOllamaProvider(),
      model: "m",
      instruction: "p",
    });
    const accepted = createLlmGate({
      provider: createOpenRouterProvider({ apiKey: "k" }),
      model: "m",
      instruction: "p",
    });
    expect([refused, accepted]).toHaveLength(2);
  });
});
