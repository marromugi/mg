import type {
  GenerateRequest,
  GenerateResponse,
  Provider,
  StreamEvent,
} from "@mg/core";
import { describe, expect, test, vi } from "vitest";
import { GateError } from "../errors.js";
import type { GateRequest } from "../types.js";
import { createLlmGate } from "./index.js";

const stubProvider = (
  respond: (request: GenerateRequest) => GenerateResponse,
): Provider => {
  const generate = vi.fn(
    async (request: GenerateRequest): Promise<GenerateResponse> =>
      respond(request),
  );
  const stream = vi.fn((): AsyncIterable<StreamEvent> => {
    throw new Error("stubProvider: stream is not scripted");
  });
  return { generate, stream };
};

const verdictResponse = (
  args: Record<string, unknown>,
): GenerateResponse => ({
  content: "",
  toolCalls: [{ id: "call-1", name: "verdict", arguments: args }],
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
      policy: "Allow read-only commands.",
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
      policy: "Allow read-only commands.",
    });

    await expect(gate.judge(request)).resolves.toEqual({
      allowed: false,
      reason: "writes to disk",
    });
  });

  test("sends the policy in system and the kind and description in user", async () => {
    let seen: GenerateRequest | undefined;
    const provider = stubProvider((generateRequest) => {
      seen = generateRequest;
      return verdictResponse({ allowed: true, reason: "ok" });
    });
    const gate = createLlmGate({
      provider,
      model: "m",
      policy: "Allow read-only commands.",
    });

    await gate.judge(request);

    if (seen === undefined) throw new Error("request not captured");

    expect(seen.messages[0]).toMatchObject({ role: "system" });
    expect((seen.messages[0] as { content: string }).content).toContain(
      "Allow read-only commands.",
    );
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
      policy: "policy",
    });

    await gate.judge(request);

    expect(seen?.toolChoice).toEqual({ type: "tool", name: "verdict" });
  });

  test("throws GateError when no toolCalls are returned", async () => {
    const provider = stubProvider(() => ({
      content: "no tools called",
      toolCalls: [],
      finishReason: "stop",
    }));
    const gate = createLlmGate({
      provider,
      model: "m",
      policy: "policy",
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
      policy: "policy",
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
    const provider: Provider = { generate, stream };
    const gate = createLlmGate({
      provider,
      model: "m",
      policy: "policy",
    });

    const error = await gate
      .judge(request)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(GateError);
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
    const provider: Provider = { generate, stream };
    const gate = createLlmGate({
      provider,
      model: "m",
      policy: "policy",
    });

    await expect(gate.judge(request)).rejects.toBe(abortError);
  });

  test("rejects with AbortError without calling the provider when the signal is already aborted", async () => {
    const provider = stubProvider(() =>
      verdictResponse({ allowed: true, reason: "ok" }),
    );
    const gate = createLlmGate({
      provider,
      model: "m",
      policy: "policy",
    });
    const controller = new AbortController();
    controller.abort();

    const error = await gate
      .judge(request, { signal: controller.signal })
      .catch((thrown: unknown) => thrown);

    expect(error).toMatchObject({ name: "AbortError" });
    expect(provider.generate).not.toHaveBeenCalled();
  });
});
