import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Reach, ToolCall } from "@mg/core";
import type { TraceAttributes, TraceSpan } from "@mg/harness";
import { ATTR, SPAN } from "@mg/trace";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
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

  startRoot(name: string, attributes?: TraceAttributes): TraceSpan {
    return this.startSpan(name, attributes);
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

const toolCallRequest = (
  call: ToolCall,
  reach: Reach = { kind: "any-local" },
): GateRequest => {
  const payload: ToolCallPayload = { call, reach };
  return {
    kind: TOOL_CALL_KIND,
    description: `Tool: ${call.name}`,
    payload,
  };
};

const root = realpathSync(tmpdir());

const call = (
  name: string,
  args: Record<string, unknown> = {},
): ToolCall => ({ id: "call-1", name, arguments: args });

const files = (...paths: [string, "file" | "tree"][]): Reach => ({
  kind: "paths",
  paths: paths.map(([path, extent]) => ({ path, extent })),
});

describe("createRulesGate", () => {
  test("allows a request whose kind is not tool-call, without inspecting rules", async () => {
    const gate = createRulesGate({
      root,
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
      root,
      rules: [{ tools: ["bash"], allowed: false, reason: "no shell" }],
    });

    const verdict = await gate.judge(
      toolCallRequest(call("bash", { command: "echo hi" })),
    );

    expect(verdict).toEqual({ allowed: false, reason: "no shell" });
  });

  test("a tools-only rule does not affect a call to a different tool", async () => {
    const gate = createRulesGate({
      root,
      rules: [{ tools: ["bash"], allowed: false }],
    });

    const verdict = await gate.judge(
      toolCallRequest(call("read_file", { path: "readme.md" })),
    );

    expect(verdict.allowed).toBe(true);
  });

  test("a paths-only rule denies a declared path matching the glob under any tool", async () => {
    const gate = createRulesGate({
      root,
      rules: [{ paths: ["**/.env"], allowed: false }],
    });

    const verdict = await gate.judge(
      toolCallRequest(
        call("write_file"),
        files([`${root}/sub/.env`, "file"]),
      ),
    );

    expect(verdict.allowed).toBe(false);
  });

  test("a paths-only rule does not match a call that declares no local path", async () => {
    const gate = createRulesGate({
      root,
      rules: [{ paths: ["**/.env"], allowed: false }],
    });

    const verdict = await gate.judge(
      toolCallRequest(call("bash", { command: "env" }), {
        kind: "none",
      }),
    );

    expect(verdict).toEqual({
      allowed: true,
      reason: "No rule matched.",
    });
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
    const gate = createRulesGate({ root, rules });

    const verdict = await gate.judge(
      toolCallRequest(call("write_file", { path: "notes.md" })),
    );

    expect(verdict).toEqual({ allowed: true, reason: "allowed first" });
  });

  test("allows when no rule matches", async () => {
    const gate = createRulesGate({
      root,
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
      root,
      rules: [
        {
          paths: ["**/.env"],
          allowed: false,
          reason: "secrets stay out of reach",
        },
      ],
    });

    const verdict = await gate.judge(
      toolCallRequest(
        call("write_file"),
        files([`${root}/.env`, "file"]),
      ),
    );

    expect(verdict.reason).toBe("secrets stay out of reach");
  });

  test("the default reason names the tool and the relative path", async () => {
    const gate = createRulesGate({
      root,
      rules: [{ paths: ["**/.env"], allowed: false }],
    });

    const verdict = await gate.judge(
      toolCallRequest(
        call("write_file"),
        files([`${root}/sub/.env`, "file"]),
      ),
    );

    expect(verdict.reason).toBe("Rule 0 denied write_file on sub/.env");
  });

  test("the default reason for a tools-only rule omits 'on <path>'", async () => {
    const gate = createRulesGate({
      root,
      rules: [{ tools: ["bash"], allowed: false }],
    });

    const verdict = await gate.judge(
      toolCallRequest(call("bash", { command: "echo hi" })),
    );

    expect(verdict.reason).toBe("Rule 0 denied bash");
  });

  test("throws GateError when the payload is missing call", async () => {
    const gate = createRulesGate({ root, rules: [] });

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
      root,
      rules: [{ tools: ["bash"], allowed: false, reason: "no shell" }],
    });
    const rootSpan = new RecordingSpan("root");
    const context: GateContext = { trace: rootSpan };

    await gate.judge(toolCallRequest(call("bash", {})), context);

    expect(rootSpan.children).toHaveLength(1);
    const gateSpan = rootSpan.children[0];
    expect(gateSpan.name).toBe(SPAN.gate);
    expect(gateSpan.mergedAttributes[ATTR.gateAllowed]).toBe(false);
    expect(gateSpan.mergedAttributes[ATTR.gateReason]).toBe("no shell");
    expect(gateSpan.children).toHaveLength(0);
  });

  test("does not record a span when context has no trace", async () => {
    const gate = createRulesGate({
      root,
      rules: [{ tools: ["bash"], allowed: false }],
    });

    await expect(
      gate.judge(toolCallRequest(call("bash", {}))),
    ).resolves.toMatchObject({ allowed: false });
  });

  test("rejects with AbortError without judging when the signal is already aborted", async () => {
    const gate = createRulesGate({
      root,
      rules: [{ tools: ["bash"], allowed: false }],
    });
    const controller = new AbortController();
    controller.abort();

    const error = await gate
      .judge(toolCallRequest(call("bash", {})), {
        signal: controller.signal,
      })
      .catch((thrown: unknown) => thrown);

    expect(error).toMatchObject({ name: "AbortError" });
  });
});

const reachRequest = (
  name: string,
  args: Record<string, unknown>,
  reach: Reach,
): GateRequest => ({
  kind: TOOL_CALL_KIND,
  description: `Tool: ${name}`,
  payload: { call: call(name, args), reach },
});

describe("createRulesGate reading the declared reach", () => {
  let scratch: string;
  let link: string;
  let R: string;

  beforeAll(() => {
    scratch = mkdtempSync(join(tmpdir(), "rules-gate-"));
    mkdirSync(join(scratch, "real"));
    symlinkSync(join(scratch, "real"), join(scratch, "link"));
    link = join(scratch, "link");
    R = realpathSync(join(scratch, "real"));
  });

  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  const envRule = (): PathRule => ({
    tools: ["read_file"],
    paths: ["**/.env"],
    allowed: false,
  });

  test("denies a declared file matching the glob, through a linked root, whatever the path argument says", async () => {
    const gate = createRulesGate({ root: link, rules: [envRule()] });

    const verdict = await gate.judge(
      reachRequest(
        "read_file",
        { path: "ok.txt" },
        files([`${R}/sub/.env`, "file"]),
      ),
    );

    expect(verdict).toEqual({
      allowed: false,
      reason: "Rule 0 denied read_file on sub/.env",
    });
  });

  test("allows a declared file that does not match, whatever the path argument says", async () => {
    const gate = createRulesGate({ root: link, rules: [envRule()] });

    const verdict = await gate.judge(
      reachRequest(
        "read_file",
        { path: ".env" },
        files([`${R}/src/a.ts`, "file"]),
      ),
    );

    expect(verdict).toEqual({
      allowed: true,
      reason: "No rule matched.",
    });
  });

  test("denies a tree over the root when a glob can match below it, and names the path relative to the root", async () => {
    const gate = createRulesGate({
      root: link,
      rules: [{ paths: ["**/.env"], allowed: false }],
    });

    const atRoot = await gate.judge(
      reachRequest("grep", {}, files([R, "tree"])),
    );
    const underSrc = await gate.judge(
      reachRequest("grep", {}, files([`${R}/src`, "tree"])),
    );

    expect(atRoot).toEqual({
      allowed: false,
      reason: "Rule 0 denied grep on .",
    });
    expect(underSrc).toEqual({
      allowed: false,
      reason: "Rule 0 denied grep on src",
    });
  });

  test("denies a tree at .git and allows a tree at src for a .git/** glob", async () => {
    const gate = createRulesGate({
      root: link,
      rules: [{ paths: [".git/**"], allowed: false }],
    });

    const atGit = await gate.judge(
      reachRequest("grep", {}, files([`${R}/.git`, "tree"])),
    );
    const underSrc = await gate.judge(
      reachRequest("grep", {}, files([`${R}/src`, "tree"])),
    );

    expect(atGit).toEqual({
      allowed: false,
      reason: "Rule 0 denied grep on .git",
    });
    expect(underSrc).toEqual({
      allowed: true,
      reason: "No rule matched.",
    });
  });

  test("hits on the first declared path that matches", async () => {
    const gate = createRulesGate({ root: link, rules: [envRule()] });

    const verdict = await gate.judge(
      reachRequest(
        "read_file",
        {},
        files([`${R}/a.txt`, "file"], [`${R}/sub/.env`, "file"]),
      ),
    );

    expect(verdict.reason).toBe("Rule 0 denied read_file on sub/.env");
  });

  test("hits a path outside the root for either extent, naming the absolute path", async () => {
    const gate = createRulesGate({ root: link, rules: [envRule()] });
    const withReason = createRulesGate({
      root: link,
      rules: [{ ...envRule(), reason: "no" }],
    });

    const file = await gate.judge(
      reachRequest("read_file", {}, files(["/etc/hosts", "file"])),
    );
    const tree = await gate.judge(
      reachRequest("read_file", {}, files(["/etc", "tree"])),
    );
    const custom = await withReason.judge(
      reachRequest("read_file", {}, files(["/etc/hosts", "file"])),
    );

    expect(file.reason).toBe(
      "Rule 0 denied read_file on /etc/hosts (outside the root)",
    );
    expect(tree.reason).toBe(
      "Rule 0 denied read_file on /etc (outside the root)",
    );
    expect(custom.reason).toBe("no");
  });

  test("says the paths could not be decided when the reach is any-local", async () => {
    const rule: PathRule = {
      tools: ["bash"],
      paths: ["**/.env"],
      allowed: false,
    };
    const plain = createRulesGate({ root: link, rules: [rule] });
    const withReason = createRulesGate({
      root: link,
      rules: [{ ...rule, reason: "Secrets are off limits." }],
    });
    const request = reachRequest(
      "bash",
      { command: "cat .env" },
      { kind: "any-local" },
    );

    const first = await plain.judge(request);
    const second = await withReason.judge(request);

    expect(first.reason).toBe(
      "Rule 0 denied bash: the paths it touches could not be decided.",
    );
    expect(second.reason).toBe(
      "Rule 0 denied bash: the paths it touches could not be decided. Secrets are off limits.",
    );
  });

  test("does not apply a paths rule to an outside or none reach", async () => {
    const gate = createRulesGate({
      root: link,
      rules: [{ paths: ["**"], allowed: false }],
    });

    const outside = await gate.judge(
      reachRequest("web_search", {}, { kind: "outside" }),
    );
    const none = await gate.judge(
      reachRequest("helper", {}, { kind: "none" }),
    );

    expect(outside).toEqual({
      allowed: true,
      reason: "No rule matched.",
    });
    expect(none).toEqual({ allowed: true, reason: "No rule matched." });
  });

  test("applies a tools-only rule to an outside reach", async () => {
    const gate = createRulesGate({
      root: link,
      rules: [{ tools: ["web_search"], allowed: false }],
    });

    const verdict = await gate.judge(
      reachRequest("web_search", {}, { kind: "outside" }),
    );

    expect(verdict).toEqual({
      allowed: false,
      reason: "Rule 0 denied web_search",
    });
  });

  test("rejects a payload without reach with a GateError", async () => {
    const gate = createRulesGate({ root: link, rules: [] });
    const error = await gate
      .judge({
        kind: TOOL_CALL_KIND,
        description: "no reach",
        payload: { call: call("read_file") },
      })
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(GateError);
    expect(error).toMatchObject({
      message: "Rules gate payload is missing reach",
    });
  });

  test("throws a GateError naming the root when the root cannot be resolved", async () => {
    const gate = createRulesGate({
      root: `${R}/gone`,
      rules: [envRule()],
    });
    const error = await gate
      .judge(
        reachRequest(
          "read_file",
          { path: "ok.txt" },
          files([`${R}/sub/.env`, "file"]),
        ),
      )
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(GateError);
    expect(error).toMatchObject({
      message: `cannot resolve the rules gate root: ${R}/gone`,
    });
  });
});
