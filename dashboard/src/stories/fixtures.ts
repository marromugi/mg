import type { HarnessDefinition } from "../definition/index.js";
import type { TestRunEvent } from "../test-run/index.js";
import {
  draftFromDefinition,
  emptyDraft,
} from "../harness-form/index.js";

export const filesHarness: HarnessDefinition = {
  id: "0b1c2d3e",
  name: "files",
  provider: { kind: "openrouter" },
  harness: {
    kind: "loop",
    model: "deepseek/deepseek-v4-flash",
    maxTurns: 10,
  },
  means: {
    root: "/Users/me/work",
    tools: ["read_file", "grep"],
    rules: [
      {
        paths: [".env"],
        allowed: false,
        reason: "Secrets stay private.",
      },
    ],
  },
};

export const judgedHarness: HarnessDefinition = {
  id: "4f5a6b7c",
  name: "reviewer",
  provider: { kind: "ollama", baseUrl: "http://localhost:11434" },
  harness: { kind: "loop", model: "llama3", maxTurns: 20 },
  means: {
    root: "/Users/me/work",
    tools: ["bash", "write_file"],
    rules: [],
    judge: {
      model: "llama3",
      instruction: "Refuse anything that deletes files.",
    },
  },
};

export const chatHarness: HarnessDefinition = {
  id: "8d9e0f1a",
  name: "chat",
  provider: { kind: "openrouter" },
  harness: { kind: "loop", model: "openai/gpt-5", maxTurns: 5 },
};

export const apiKeySet = {
  name: "OPENROUTER_API_KEY",
  isSet: true,
} as const;

export const apiKeyUnset = {
  name: "OPENROUTER_API_KEY",
  isSet: false,
} as const;

const TRACE_DIR =
  "/Users/me/Library/Application Support/mg-dashboard/traces";
const TRACE_PATH = `${TRACE_DIR}/6f1c.jsonl`;

export const traceDir = TRACE_DIR;

export const textEvent: TestRunEvent = {
  type: "harness",
  event: { type: "text-delta", delta: "The note says blue." },
};

export const toolCallEvent: TestRunEvent = {
  type: "harness",
  event: {
    type: "tool-call",
    toolCall: {
      id: "call-1",
      name: "read_file",
      arguments: { path: "note.txt" },
    },
  },
};

export const toolResultEvent: TestRunEvent = {
  type: "harness",
  event: {
    type: "tool-result",
    message: { role: "tool", toolCallId: "call-1", content: "1\tblue" },
  },
};

export const endedEvent: TestRunEvent = {
  type: "ended",
  reason: "stop",
  usage: { inputTokens: 120, outputTokens: 18 },
  tracePath: TRACE_PATH,
};

export const stoppedEvent: TestRunEvent = {
  type: "stopped",
  tracePath: TRACE_PATH,
};

export const failedEvent: TestRunEvent = {
  type: "failed",
  message: "OpenRouter request failed: HTTP 401",
  tracePath: TRACE_PATH,
};

export const newDraft = emptyDraft();
export const filesDraft = draftFromDefinition(filesHarness);
export const judgedDraft = draftFromDefinition(judgedHarness);
