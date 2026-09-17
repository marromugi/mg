import type {
  SessionSummary,
  SessionTree,
  SpanNode,
} from "@mg/trace/store";
import { ATTR, SPAN } from "../vocabulary.js";

export const START_TIME = "2026-01-01T00:00:00.000Z";
export const END_TIME = "2026-01-01T00:00:01.000Z";
export const SESSION_ID = "session-1";
export const TRACE_ID = "trace-1";

export const toolNode: SpanNode = {
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

export const llmNode: SpanNode = {
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

export const rootNode: SpanNode = {
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

export const sessionTree: SessionTree = {
  sessionId: SESSION_ID,
  serviceName: "svc",
  startTime: START_TIME,
  endTime: END_TIME,
  traces: [{ traceId: TRACE_ID, root: rootNode }],
};

export const OBJECT_CONTENT_SESSION_ID = "session-object-content";
export const OBJECT_CONTENT_TRACE_ID = "trace-object-content";

export const objectContentLlmNode: SpanNode = {
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

export const objectContentRootNode: SpanNode = {
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

export const objectContentSessionTree: SessionTree = {
  sessionId: OBJECT_CONTENT_SESSION_ID,
  serviceName: "svc",
  startTime: START_TIME,
  endTime: END_TIME,
  traces: [
    { traceId: OBJECT_CONTENT_TRACE_ID, root: objectContentRootNode },
  ],
};

export const NEW_SHAPE_SESSION_ID = "session-new-shape";
export const NEW_SHAPE_TRACE_ID = "trace-new-shape";

export const newShapeLlmNode: SpanNode = {
  sessionId: NEW_SHAPE_SESSION_ID,
  serviceName: "svc",
  traceId: NEW_SHAPE_TRACE_ID,
  spanId: "span-llm-new-shape",
  name: SPAN.llm,
  startTime: START_TIME,
  endTime: END_TIME,
  attributes: {
    [ATTR.llmModel]: "gpt-test",
    [ATTR.llmFinishReason]: "tool_calls",
    [ATTR.llmOutputMessages]: JSON.stringify([
      {
        role: "assistant",
        parts: [
          { type: "reasoning", text: "checking the forecast" },
          { type: "text", text: "It should be sunny." },
          {
            type: "tool-call",
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
  children: [],
};

export const sessionSummaries: SessionSummary[] = [
  {
    sessionId: SESSION_ID,
    serviceName: "svc",
    startTime: START_TIME,
    endTime: END_TIME,
    traceCount: 1,
  },
  {
    sessionId: "session-2",
    serviceName: "svc",
    startTime: "2026-01-01T00:02:00.000Z",
    endTime: "2026-01-01T00:02:03.000Z",
    traceCount: 2,
  },
  {
    sessionId: "session-3",
    serviceName: "svc",
    startTime: "2026-01-01T00:03:00.000Z",
    endTime: "2026-01-01T00:03:05.000Z",
    traceCount: 0,
  },
];
