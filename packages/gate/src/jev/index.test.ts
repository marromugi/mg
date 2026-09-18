import type { TraceAttributes, TraceSpan } from "@mg/harness";
import { ATTR, SPAN } from "@mg/trace";
import { describe, expect, test, vi } from "vitest";
import { GateError } from "../errors.js";
import type { GateContext, GateRequest } from "../types.js";
import { createJevGate } from "./index.js";

class RecordingSpan implements TraceSpan {
  readonly name: string;
  readonly attributes: TraceAttributes;
  readonly children: RecordingSpan[] = [];
  readonly setAttributesCalls: TraceAttributes[] = [];

  constructor(name: string, attributes?: TraceAttributes) {
    this.name = name;
    this.attributes = attributes ?? {};
  }

  startSpan(name: string, attributes?: TraceAttributes): TraceSpan {
    const child = new RecordingSpan(name, attributes);
    this.children.push(child);
    return child;
  }

  setAttributes(attributes: TraceAttributes): void {
    this.setAttributesCalls.push(attributes);
  }

  addEvent(): void {}

  end(): void {}

  get mergedAttributes(): TraceAttributes {
    return Object.assign(
      {},
      this.attributes,
      ...this.setAttributesCalls,
    );
  }
}

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const allowedAnswer = (probability: number): unknown => ({
  answers: { allowed: { type: "noul", probability } },
});

const request: GateRequest = {
  kind: "tool-call",
  description: "Runs `bash` with command: echo hi",
};

describe("createJevGate", () => {
  test("sends to the systemone URL with the bearer header and JSON content type", async () => {
    const fetchStub = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) =>
        jsonResponse(allowedAnswer(0.9)),
    );
    const gate = createJevGate({
      apiKey: "key-123",
      policy: "Allow read-only commands.",
      fetch: fetchStub,
    });

    await gate.judge(request);

    expect(fetchStub).toHaveBeenCalledTimes(1);
    const [url, init] = fetchStub.mock.calls[0];
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer key-123");
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  test("trims a trailing slash from a custom baseUrl", async () => {
    const fetchStub = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) =>
        jsonResponse(allowedAnswer(0.9)),
    );
    const gate = createJevGate({
      apiKey: "key",
      policy: "policy",
      baseUrl: "https://example.test/v2/",
      fetch: fetchStub,
    });

    await gate.judge(request);

    const [url] = fetchStub.mock.calls[0];
    expect(url).toBe("https://example.test/v2/systemone");
  });

  test("carries the request description in state and the policy in questions.allowed.instructions, with question type noul", async () => {
    const fetchStub = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) =>
        jsonResponse(allowedAnswer(0.9)),
    );
    const gate = createJevGate({
      apiKey: "key",
      policy: "Allow read-only commands.",
      fetch: fetchStub,
    });

    await gate.judge(request);

    const [, init] = fetchStub.mock.calls[0];
    if (init === undefined) throw new Error("init not captured");
    const body = JSON.parse(init.body as string) as {
      state: string;
      questions: {
        allowed: { type: string; instructions: string };
      };
    };
    expect(body.state).toBe(`Kind: tool-call\n${request.description}`);
    expect(body.questions.allowed.type).toBe("noul");
    expect(body.questions.allowed.instructions).toContain(
      "Allow read-only commands.",
    );
  });

  test("allows when the probability is at or above the threshold", async () => {
    const fetchStub = vi.fn(async () =>
      jsonResponse(allowedAnswer(0.5)),
    );
    const gate = createJevGate({
      apiKey: "key",
      policy: "policy",
      fetch: fetchStub,
    });

    await expect(gate.judge(request)).resolves.toMatchObject({
      allowed: true,
    });
  });

  test("denies when the probability is below the threshold", async () => {
    const fetchStub = vi.fn(async () =>
      jsonResponse(allowedAnswer(0.49)),
    );
    const gate = createJevGate({
      apiKey: "key",
      policy: "policy",
      fetch: fetchStub,
    });

    await expect(gate.judge(request)).resolves.toMatchObject({
      allowed: false,
    });
  });

  test("reason contains the probability and the threshold", async () => {
    const fetchStub = vi.fn(async () =>
      jsonResponse(allowedAnswer(0.93)),
    );
    const gate = createJevGate({
      apiKey: "key",
      policy: "policy",
      fetch: fetchStub,
    });

    const verdict = await gate.judge(request);

    expect(verdict.reason).toContain("0.93");
    expect(verdict.reason).toContain("0.50");
  });

  test("a custom threshold moves the boundary", async () => {
    const fetchStub = vi.fn(async () =>
      jsonResponse(allowedAnswer(0.6)),
    );
    const gate = createJevGate({
      apiKey: "key",
      policy: "policy",
      threshold: 0.7,
      fetch: fetchStub,
    });

    const verdict = await gate.judge(request);

    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toContain("0.70");
  });

  test("throws GateError on a non-2xx response", async () => {
    const fetchStub = vi.fn(
      async () => new Response("nope", { status: 500 }),
    );
    const gate = createJevGate({
      apiKey: "key",
      policy: "policy",
      fetch: fetchStub,
    });

    await expect(gate.judge(request)).rejects.toBeInstanceOf(GateError);
  });

  test("throws GateError when the body has the wrong shape", async () => {
    const fetchStub = vi.fn(async () =>
      jsonResponse({ answers: { allowed: { type: "noul" } } }),
    );
    const gate = createJevGate({
      apiKey: "key",
      policy: "policy",
      fetch: fetchStub,
    });

    await expect(gate.judge(request)).rejects.toBeInstanceOf(GateError);
  });

  test("throws GateError with the original error as cause when fetch rejects", async () => {
    const original = new Error("network down");
    const fetchStub = vi.fn(async () => {
      throw original;
    });
    const gate = createJevGate({
      apiKey: "key",
      policy: "policy",
      fetch: fetchStub,
    });

    const error = await gate
      .judge(request)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(GateError);
    expect((error as GateError).cause).toBe(original);
  });

  test("rejects without calling fetch when the signal is already aborted", async () => {
    const fetchStub = vi.fn(async () =>
      jsonResponse(allowedAnswer(0.9)),
    );
    const gate = createJevGate({
      apiKey: "key",
      policy: "policy",
      fetch: fetchStub,
    });
    const controller = new AbortController();
    controller.abort();

    const error = await gate
      .judge(request, { signal: controller.signal })
      .catch((thrown: unknown) => thrown);

    expect(error).toMatchObject({ name: "AbortError" });
    expect(fetchStub).not.toHaveBeenCalled();
  });

  test("records exactly one mg.gate span with allowed, reason and model, and no child span", async () => {
    const fetchStub = vi.fn(async () =>
      jsonResponse(allowedAnswer(0.9)),
    );
    const gate = createJevGate({
      apiKey: "key",
      policy: "policy",
      model: "jev-x",
      fetch: fetchStub,
    });
    const root = new RecordingSpan("root");
    const context: GateContext = { trace: root };

    await gate.judge(request, context);

    expect(root.children).toHaveLength(1);
    const gateSpan = root.children[0];
    expect(gateSpan.name).toBe(SPAN.gate);
    expect(gateSpan.mergedAttributes[ATTR.gateModel]).toBe("jev-x");
    expect(gateSpan.mergedAttributes[ATTR.gateAllowed]).toBe(true);
    expect(typeof gateSpan.mergedAttributes[ATTR.gateReason]).toBe(
      "string",
    );
    expect(gateSpan.children).toHaveLength(0);
  });

  test("does not record a span and calls fetch directly when context has no trace", async () => {
    const fetchStub = vi.fn(async () =>
      jsonResponse(allowedAnswer(0.9)),
    );
    const gate = createJevGate({
      apiKey: "key",
      policy: "policy",
      fetch: fetchStub,
    });

    await expect(gate.judge(request)).resolves.toMatchObject({
      allowed: true,
    });
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });
});
