import type {
  SessionTree,
  SpanNode,
  TraceReader,
} from "@mg/trace/store";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { ATTR, SPAN } from "./vocabulary.js";

const START_TIME = "2026-01-01T00:00:00.000Z";
const END_TIME = "2026-01-01T00:00:01.000Z";
const SESSION_ID = "session-1";
const TRACE_ID = "trace-1";

const toolNode: SpanNode = {
  sessionId: SESSION_ID,
  serviceName: "svc",
  traceId: TRACE_ID,
  spanId: "span-tool",
  name: SPAN.tool,
  startTime: START_TIME,
  endTime: END_TIME,
  attributes: {
    [ATTR.toolName]: "web-search",
    [ATTR.toolArguments]: JSON.stringify({ query: "weather" }),
    [ATTR.toolResult]: "no results",
  },
  events: [],
  status: { code: 2, message: "search failed: timeout" },
  children: [],
};

const llmNode: SpanNode = {
  sessionId: SESSION_ID,
  serviceName: "svc",
  traceId: TRACE_ID,
  spanId: "span-llm",
  name: SPAN.llm,
  startTime: START_TIME,
  endTime: END_TIME,
  attributes: {
    [ATTR.llmModel]: "gpt-test",
    [ATTR.llmFinishReason]: "tool_calls",
    [ATTR.llmInputTokens]: 10,
    [ATTR.llmOutputTokens]: 5,
    [ATTR.llmInputMessages]: JSON.stringify([
      { role: "user", content: "Hello there" },
    ]),
    [ATTR.llmOutputMessages]: JSON.stringify([
      {
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "call-1",
            name: "web-search",
            arguments: { query: "weather" },
          },
        ],
      },
    ]),
  },
  events: [],
  status: { code: 0 },
  children: [toolNode],
};

const rootNode: SpanNode = {
  sessionId: SESSION_ID,
  serviceName: "svc",
  traceId: TRACE_ID,
  spanId: "span-root",
  name: SPAN.harness,
  startTime: START_TIME,
  endTime: END_TIME,
  attributes: {},
  events: [],
  status: { code: 0 },
  children: [llmNode],
};

const sessionTree: SessionTree = {
  sessionId: SESSION_ID,
  serviceName: "svc",
  startTime: START_TIME,
  endTime: END_TIME,
  traces: [{ traceId: TRACE_ID, root: rootNode }],
};

const OBJECT_CONTENT_SESSION_ID = "session-object-content";
const OBJECT_CONTENT_TRACE_ID = "trace-object-content";

const objectContentLlmNode: SpanNode = {
  sessionId: OBJECT_CONTENT_SESSION_ID,
  serviceName: "svc",
  traceId: OBJECT_CONTENT_TRACE_ID,
  spanId: "span-llm-object-content",
  name: SPAN.llm,
  startTime: START_TIME,
  endTime: END_TIME,
  attributes: {
    [ATTR.llmModel]: "gpt-test",
    [ATTR.llmInputMessages]: JSON.stringify([
      { role: "user", content: { text: "hi" } },
    ]),
  },
  events: [],
  status: { code: 0 },
  children: [],
};

const objectContentRootNode: SpanNode = {
  sessionId: OBJECT_CONTENT_SESSION_ID,
  serviceName: "svc",
  traceId: OBJECT_CONTENT_TRACE_ID,
  spanId: "span-root-object-content",
  name: SPAN.harness,
  startTime: START_TIME,
  endTime: END_TIME,
  attributes: {},
  events: [],
  status: { code: 0 },
  children: [objectContentLlmNode],
};

const objectContentSessionTree: SessionTree = {
  sessionId: OBJECT_CONTENT_SESSION_ID,
  serviceName: "svc",
  startTime: START_TIME,
  endTime: END_TIME,
  traces: [
    { traceId: OBJECT_CONTENT_TRACE_ID, root: objectContentRootNode },
  ],
};

const sessionsById = new Map<string, SessionTree>([
  [SESSION_ID, sessionTree],
  [OBJECT_CONTENT_SESSION_ID, objectContentSessionTree],
]);

class FakeTraceReader implements TraceReader {
  async listSessions() {
    return [
      {
        sessionId: SESSION_ID,
        serviceName: "svc",
        startTime: START_TIME,
        endTime: END_TIME,
        traceCount: 1,
      },
    ];
  }

  async readSession(sessionId: string) {
    return sessionsById.get(sessionId);
  }
}

describe("createApp", () => {
  it("lists the session id, times, and trace count on GET /", async () => {
    const app = createApp(new FakeTraceReader());
    const res = await app.request("/");
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(text).toContain(SESSION_ID);
    expect(text).toContain(START_TIME);
    expect(text).toContain(END_TIME);
  });

  it("shows the model, a user message, a tool name, and a failed span's error on GET /sessions/:id", async () => {
    const app = createApp(new FakeTraceReader());
    const res = await app.request(`/sessions/${SESSION_ID}`);
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(text).toContain("gpt-test");
    expect(text).toContain("Hello there");
    expect(text).toContain("web-search");
    expect(text).toContain("search failed: timeout");
  });

  it("returns 200 for a span whose message content is not a string", async () => {
    const app = createApp(new FakeTraceReader());
    const res = await app.request(
      `/sessions/${OBJECT_CONTENT_SESSION_ID}`,
    );

    expect(res.status).toBe(200);
  });

  it("returns 404 for an unknown session id", async () => {
    const app = createApp(new FakeTraceReader());
    const res = await app.request("/sessions/no-such-session");

    expect(res.status).toBe(404);
  });
});
