import type { SessionTree } from "@mg/trace/store";
import { describe, expect, it, vi } from "vitest";
import { JevCheckError } from "./errors.js";
import { createJevChecker } from "./jev.js";
import { transcribe } from "./transcript.js";
import type { EvalInput } from "./types.js";
import type { RunView } from "./view.js";

const makeView = (overrides: Partial<RunView> = {}): RunView => ({
  sessionId: "session-1",
  steps: [],
  llmSteps: [],
  toolSteps: [],
  gateSteps: [],
  turnCount: 0,
  finalText: "the assistant said hello",
  usage: { inputTokens: 0, outputTokens: 0 },
  startTime: "2026-01-01T00:00:00.000Z",
  endTime: "2026-01-01T00:00:01.000Z",
  ...overrides,
});

const makeSession = (view: RunView): SessionTree => ({
  sessionId: view.sessionId,
  serviceName: "svc",
  startTime: view.startTime,
  endTime: view.endTime,
  traces: [],
});

const makeInput = (view: RunView): EvalInput => ({
  session: makeSession(view),
  view,
});

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const answer = (probability: number): unknown => ({
  answers: { answer: { type: "noul", probability } },
});

describe("createJevChecker", () => {
  it("sends to the systemone URL with the bearer header and JSON content type", async () => {
    const fetchStub = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) =>
        jsonResponse(answer(0.95)),
    );
    const checker = createJevChecker({
      apiKey: "key-123",
      fetch: fetchStub,
    });
    const check = checker({
      name: "polite",
      question: "Is it polite?",
    });

    await check.evaluate(makeInput(makeView()));

    expect(fetchStub).toHaveBeenCalledTimes(1);
    const [url, init] = fetchStub.mock.calls[0];
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer key-123");
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  it("trims a trailing slash from a custom baseUrl", async () => {
    const fetchStub = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) =>
        jsonResponse(answer(0.95)),
    );
    const checker = createJevChecker({
      apiKey: "key",
      baseUrl: "https://example.test/v2/",
      fetch: fetchStub,
    });
    const check = checker({
      name: "polite",
      question: "Is it polite?",
    });

    await check.evaluate(makeInput(makeView()));

    const [url] = fetchStub.mock.calls[0];
    expect(url).toBe("https://example.test/v2/systemone");
  });

  it("sends the transcript as state and the question as instructions, with type noul", async () => {
    const fetchStub = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) =>
        jsonResponse(answer(0.95)),
    );
    const checker = createJevChecker({
      apiKey: "key",
      fetch: fetchStub,
    });
    const view = makeView({
      steps: [
        {
          type: "tool",
          spanId: "span-1",
          startTime: "2026-01-01T00:00:00.000Z",
          endTime: "2026-01-01T00:00:01.000Z",
          name: "bash",
          arguments: { command: "echo hi" },
          result: "hi",
        },
      ],
    });
    const check = checker({
      name: "polite",
      question: "Is the reply polite?",
    });

    await check.evaluate(makeInput(view));

    const [, init] = fetchStub.mock.calls[0];
    if (init === undefined) throw new Error("init not captured");
    const body = JSON.parse(init.body as string) as {
      model: string;
      state: string;
      questions: {
        answer: { type: string; instructions: string };
      };
    };
    expect(body.model).toBe("jev-latest");
    expect(body.state).toBe(transcribe(view));
    expect(body.questions.answer.type).toBe("noul");
    expect(body.questions.answer.instructions).toBe(
      "Is the reply polite?",
    );
  });

  it("uses a custom transcribe function instead of the default transcript", async () => {
    const fetchStub = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) =>
        jsonResponse(answer(0.95)),
    );
    const customTranscribe = vi.fn(() => "custom transcript text");
    const checker = createJevChecker({
      apiKey: "key",
      fetch: fetchStub,
      transcribe: customTranscribe,
    });
    const view = makeView();
    const check = checker({
      name: "polite",
      question: "Is it polite?",
    });

    await check.evaluate(makeInput(view));

    expect(customTranscribe).toHaveBeenCalledWith(view);
    const [, init] = fetchStub.mock.calls[0];
    if (init === undefined) throw new Error("init not captured");
    const body = JSON.parse(init.body as string) as { state: string };
    expect(body.state).toBe("custom transcript text");
  });

  it("passes when the probability is at or above the threshold", async () => {
    const fetchStub = vi.fn(async () => jsonResponse(answer(0.9)));
    const checker = createJevChecker({
      apiKey: "key",
      fetch: fetchStub,
    });
    const check = checker({
      name: "polite",
      question: "Is it polite?",
      threshold: 0.9,
    });

    const outcome = await check.evaluate(makeInput(makeView()));

    expect(outcome.passed).toBe(true);
    expect(outcome.score).toBe(0.9);
    expect(outcome.threshold).toBe(0.9);
  });

  it("fails when the probability is below the threshold", async () => {
    const fetchStub = vi.fn(async () => jsonResponse(answer(0.89)));
    const checker = createJevChecker({
      apiKey: "key",
      fetch: fetchStub,
    });
    const check = checker({
      name: "polite",
      question: "Is it polite?",
      threshold: 0.9,
    });

    const outcome = await check.evaluate(makeInput(makeView()));

    expect(outcome.passed).toBe(false);
  });

  it("defaults the threshold to 0.9 when omitted", async () => {
    const fetchStub = vi.fn(async () => jsonResponse(answer(0.89)));
    const checker = createJevChecker({
      apiKey: "key",
      fetch: fetchStub,
    });
    const check = checker({
      name: "polite",
      question: "Is it polite?",
    });

    const outcome = await check.evaluate(makeInput(makeView()));

    expect(outcome.threshold).toBe(0.9);
    expect(outcome.passed).toBe(false);
  });

  it("puts the probability and threshold in the reason text", async () => {
    const fetchStub = vi.fn(async () => jsonResponse(answer(0.923)));
    const checker = createJevChecker({
      apiKey: "key",
      fetch: fetchStub,
    });
    const check = checker({
      name: "polite",
      question: "Is it polite?",
      threshold: 0.8,
    });

    const outcome = await check.evaluate(makeInput(makeView()));

    expect(outcome.reason).toBe("Jev answered 0.923; threshold 0.8");
  });

  it("throws JevCheckError with the original error as cause when fetch rejects", async () => {
    const original = new Error("network down");
    const fetchStub = vi.fn(async () => {
      throw original;
    });
    const checker = createJevChecker({
      apiKey: "key",
      fetch: fetchStub,
    });
    const check = checker({
      name: "polite",
      question: "Is it polite?",
    });

    const error = await check
      .evaluate(makeInput(makeView()))
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(JevCheckError);
    expect((error as JevCheckError).message).toBe("Jev request failed");
    expect((error as JevCheckError).cause).toBe(original);
  });

  it("throws JevCheckError on a non-2xx response, with status and body in the message", async () => {
    const fetchStub = vi.fn(
      async () => new Response("invalid api key", { status: 401 }),
    );
    const checker = createJevChecker({
      apiKey: "key",
      fetch: fetchStub,
    });
    const check = checker({
      name: "polite",
      question: "Is it polite?",
    });

    const error = await check
      .evaluate(makeInput(makeView()))
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(JevCheckError);
    expect((error as JevCheckError).message).toContain("401");
    expect((error as JevCheckError).message).toContain(
      "invalid api key",
    );
  });

  it("throws JevCheckError when the response body is not JSON", async () => {
    const response = new Response("not json", { status: 200 });
    const fetchStub = vi.fn(async () => response);
    const checker = createJevChecker({
      apiKey: "key",
      fetch: fetchStub,
    });
    const check = checker({
      name: "polite",
      question: "Is it polite?",
    });

    const error = await check
      .evaluate(makeInput(makeView()))
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(JevCheckError);
    expect((error as JevCheckError).message).toBe(
      "Jev response is not JSON",
    );
  });

  it("throws JevCheckError when the response body fails schema validation", async () => {
    const fetchStub = vi.fn(async () =>
      jsonResponse({ answers: { answer: { type: "noul" } } }),
    );
    const checker = createJevChecker({
      apiKey: "key",
      fetch: fetchStub,
    });
    const check = checker({
      name: "polite",
      question: "Is it polite?",
    });

    const error = await check
      .evaluate(makeInput(makeView()))
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(JevCheckError);
    expect((error as JevCheckError).message).toBe(
      "Jev response failed validation",
    );
  });

  it("lets an abort while reading the response body through unchanged", async () => {
    const abortError = new DOMException("aborted", "AbortError");
    const response = new Response(null, { status: 200 });
    vi.spyOn(response, "json").mockRejectedValue(abortError);
    const fetchStub = vi.fn(async () => response);
    const checker = createJevChecker({
      apiKey: "key",
      fetch: fetchStub,
    });
    const check = checker({
      name: "polite",
      question: "Is it polite?",
    });

    await expect(check.evaluate(makeInput(makeView()))).rejects.toBe(
      abortError,
    );
  });

  it("rejects without calling fetch when the signal is already aborted", async () => {
    const fetchStub = vi.fn(async () => jsonResponse(answer(0.95)));
    const checker = createJevChecker({
      apiKey: "key",
      fetch: fetchStub,
    });
    const check = checker({
      name: "polite",
      question: "Is it polite?",
    });
    const controller = new AbortController();
    controller.abort();

    const error = await check
      .evaluate(makeInput(makeView()), { signal: controller.signal })
      .catch((thrown: unknown) => thrown);

    expect(error).toMatchObject({ name: "AbortError" });
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("rejects an out-of-range threshold at creation time", () => {
    const checker = createJevChecker({ apiKey: "key" });

    expect(() =>
      checker({
        name: "polite",
        question: "Is it polite?",
        threshold: 1.1,
      }),
    ).toThrow(RangeError);
    expect(() =>
      checker({
        name: "polite",
        question: "Is it polite?",
        threshold: -0.1,
      }),
    ).toThrow(RangeError);
    expect(() =>
      checker({
        name: "polite",
        question: "Is it polite?",
        threshold: Number.NaN,
      }),
    ).toThrow(RangeError);
  });

  it("rejects an empty name or question at creation time", () => {
    const checker = createJevChecker({ apiKey: "key" });

    expect(() =>
      checker({ name: "", question: "Is it polite?" }),
    ).toThrow(RangeError);
    expect(() => checker({ name: "polite", question: "" })).toThrow(
      RangeError,
    );
  });
});
