import type { ToolCall } from "@mg/core";
import type { TraceAttributes, TraceSpan } from "@mg/harness";
import { ATTR, SPAN } from "@mg/trace";
import { describe, expect, test } from "vitest";
import { GateError } from "../errors.js";
import { TOOL_CALL_KIND, type ToolCallPayload } from "../tool-gate.js";
import type { GateContext, GateRequest } from "../types.js";
import { createRulesGate, type PathRule } from "./index.js";

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

const toolCallRequest = (call: ToolCall): GateRequest => {
  const payload: ToolCallPayload = { call };
  return {
    kind: TOOL_CALL_KIND,
    description: `Tool: ${call.name}`,
    payload,
  };
};

const call = (
  name: string,
  args: Record<string, unknown> = {},
): ToolCall => ({ id: "call-1", name, arguments: args });

describe("createRulesGate", () => {
  test("allows a request whose kind is not tool-call, without inspecting rules", async () => {
    const gate = createRulesGate({
      root: "/repo",
      rules: [{ tools: ["write_file"], allowed: false }],
    });

    const verdict = await gate.judge({
      kind: "other-kind",
      description: "not a tool call",
    });

    expect(verdict).toEqual({
      allowed: true,
      reason: "No rule applies to this request.",
    });
  });

  test("a tools-only rule denies the named tool regardless of path", async () => {
    const gate = createRulesGate({
      root: "/repo",
      rules: [{ tools: ["bash"], allowed: false, reason: "no shell" }],
    });

    const verdict = await gate.judge(
      toolCallRequest(call("bash", { command: "echo hi" })),
    );

    expect(verdict).toEqual({ allowed: false, reason: "no shell" });
  });

  test("a tools-only rule does not affect a call to a different tool", async () => {
    const gate = createRulesGate({
      root: "/repo",
      rules: [{ tools: ["bash"], allowed: false }],
    });

    const verdict = await gate.judge(
      toolCallRequest(call("read_file", { path: "readme.md" })),
    );

    expect(verdict.allowed).toBe(true);
  });

  test("a paths-only rule denies a matching glob under any tool that supplies a path", async () => {
    const gate = createRulesGate({
      root: "/repo",
      rules: [{ paths: ["**/.env"], allowed: false }],
    });

    const verdict = await gate.judge(
      toolCallRequest(call("write_file", { path: "sub/.env" })),
    );

    expect(verdict.allowed).toBe(false);
  });

  test("a paths-only rule does not match a call without a path argument", async () => {
    const gate = createRulesGate({
      root: "/repo",
      rules: [{ paths: ["**/.env"], allowed: false }],
    });

    const verdict = await gate.judge(
      toolCallRequest(call("bash", { command: "env" })),
    );

    expect(verdict).toEqual({
      allowed: true,
      reason: "No rule matched.",
    });
  });

  test("normalizes '..' in the argument before matching", async () => {
    const gate = createRulesGate({
      root: "/repo",
      rules: [{ paths: ["**/.env"], allowed: false }],
    });

    const verdict = await gate.judge(
      toolCallRequest(call("write_file", { path: "sub/../.env" })),
    );

    expect(verdict.allowed).toBe(false);
  });

  test("the first matching rule wins over a later contradicting one", async () => {
    const rules: PathRule[] = [
      { tools: ["write_file"], allowed: true, reason: "allowed first" },
      {
        tools: ["write_file"],
        allowed: false,
        reason: "denied second",
      },
    ];
    const gate = createRulesGate({ root: "/repo", rules });

    const verdict = await gate.judge(
      toolCallRequest(call("write_file", { path: "notes.md" })),
    );

    expect(verdict).toEqual({ allowed: true, reason: "allowed first" });
  });

  test("allows when no rule matches", async () => {
    const gate = createRulesGate({
      root: "/repo",
      rules: [{ tools: ["bash"], allowed: false }],
    });

    const verdict = await gate.judge(
      toolCallRequest(call("read_file", { path: "notes.md" })),
    );

    expect(verdict).toEqual({
      allowed: true,
      reason: "No rule matched.",
    });
  });

  test("a custom reason is returned verbatim", async () => {
    const gate = createRulesGate({
      root: "/repo",
      rules: [
        {
          paths: ["**/.env"],
          allowed: false,
          reason: "secrets stay out of reach",
        },
      ],
    });

    const verdict = await gate.judge(
      toolCallRequest(call("write_file", { path: ".env" })),
    );

    expect(verdict.reason).toBe("secrets stay out of reach");
  });

  test("the default reason names the tool and the relative path", async () => {
    const gate = createRulesGate({
      root: "/repo",
      rules: [{ paths: ["**/.env"], allowed: false }],
    });

    const verdict = await gate.judge(
      toolCallRequest(call("write_file", { path: "sub/.env" })),
    );

    expect(verdict.reason).toBe("Rule 0 denied write_file on sub/.env");
  });

  test("throws GateError when the payload is missing call", async () => {
    const gate = createRulesGate({ root: "/repo", rules: [] });

    await expect(
      gate.judge({
        kind: TOOL_CALL_KIND,
        description: "malformed",
        payload: {},
      }),
    ).rejects.toBeInstanceOf(GateError);
  });

  test("records exactly one mg.gate span with allowed and reason, and no child span", async () => {
    const gate = createRulesGate({
      root: "/repo",
      rules: [{ tools: ["bash"], allowed: false, reason: "no shell" }],
    });
    const root = new RecordingSpan("root");
    const context: GateContext = { trace: root };

    await gate.judge(toolCallRequest(call("bash", {})), context);

    expect(root.children).toHaveLength(1);
    const gateSpan = root.children[0];
    expect(gateSpan.name).toBe(SPAN.gate);
    expect(gateSpan.mergedAttributes[ATTR.gateAllowed]).toBe(false);
    expect(gateSpan.mergedAttributes[ATTR.gateReason]).toBe("no shell");
    expect(gateSpan.children).toHaveLength(0);
  });

  test("does not record a span when context has no trace", async () => {
    const gate = createRulesGate({
      root: "/repo",
      rules: [{ tools: ["bash"], allowed: false }],
    });

    await expect(
      gate.judge(toolCallRequest(call("bash", {}))),
    ).resolves.toMatchObject({ allowed: false });
  });
});
