import type { HarnessEvent } from "@mg/harness";
import { createTerm } from "@mg/term";
import { describe, expect, test } from "vitest";
import type { RunStart } from "./show-run.ts";
import { describeError, showRun } from "./show-run.ts";

function fakeStart(
  events: readonly HarnessEvent[],
  outcome: { sessionId: string } | { error: unknown },
): RunStart {
  return async (onEvent) => {
    for (const event of events) onEvent(event);
    if ("error" in outcome) throw outcome.error;
    return { sessionId: outcome.sessionId };
  };
}

function capture() {
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  return {
    stdout: (text: string) => stdoutLines.push(text),
    stderr: (text: string) => stderrLines.push(text),
    out: () => stdoutLines.join(""),
    err: () => stderrLines.join(""),
  };
}

const noColor = createTerm({ isTTY: false, env: {} });

describe("showRun", () => {
  test("writes text as given, the tool call, its result, and the session id on success", async () => {
    const { stdout, stderr, out, err } = capture();
    const events: HarnessEvent[] = [
      { type: "text-delta", delta: "一覧を見ます。" },
      {
        type: "tool-call",
        toolCall: {
          id: "1",
          name: "bash",
          arguments: { command: "ls" },
        },
      },
      {
        type: "tool-result",
        message: {
          role: "tool",
          toolCallId: "1",
          content: "a.txt\nb.txt",
        },
      },
      { type: "text-delta", delta: "2 つあります。" },
    ];

    const code = await showRun(
      fakeStart(events, { sessionId: "s-1" }),
      {
        stdout,
        stderr,
        term: noColor,
      },
    );

    expect(out()).toBe(
      "一覧を見ます。\n" +
        '▫️ bash {"command":"ls"}\n' +
        "  a.txt\n" +
        "  b.txt\n" +
        "2 つあります。\n" +
        "✅ sessionId: s-1\n",
    );
    expect(err()).toBe("");
    expect(code).toBe(0);
  });

  test("writes an empty tool result as two spaces, and a trailing newline in the content as no extra line", async () => {
    const { stdout, stderr, out } = capture();
    const events: HarnessEvent[] = [
      {
        type: "tool-call",
        toolCall: {
          id: "1",
          name: "bash",
          arguments: { command: "ls" },
        },
      },
      {
        type: "tool-result",
        message: { role: "tool", toolCallId: "1", content: "" },
      },
      {
        type: "tool-result",
        message: { role: "tool", toolCallId: "1", content: "x\n" },
      },
    ];

    await showRun(fakeStart(events, { sessionId: "s-1" }), {
      stdout,
      stderr,
      term: noColor,
    });

    const afterCallLine = out().slice(out().indexOf("\n") + 1);
    expect(afterCallLine).toBe("  \n  x\n✅ sessionId: s-1\n");
  });

  test("paints the tool call line and each tool result line separately when color is on", async () => {
    const { stdout, stderr, out } = capture();
    const withColor = createTerm({ isTTY: true, env: {} });
    const events: HarnessEvent[] = [
      {
        type: "tool-call",
        toolCall: {
          id: "1",
          name: "bash",
          arguments: { command: "ls" },
        },
      },
      {
        type: "tool-result",
        message: { role: "tool", toolCallId: "1", content: "a\nb" },
      },
    ];

    await showRun(fakeStart(events, { sessionId: "s-1" }), {
      stdout,
      stderr,
      term: withColor,
    });

    const lines = out().split("\n");
    expect(lines[0]).toBe('\x1b[2m▫️ bash {"command":"ls"}\x1b[0m');
    expect(lines[1]).toBe("\x1b[2m  a\x1b[0m");
    expect(lines[2]).toBe("\x1b[2m  b\x1b[0m");
  });

  test("writes nothing for reasoning deltas, turn ends, or the run's own end event", async () => {
    const { stdout, stderr, out, err } = capture();
    const events: HarnessEvent[] = [
      { type: "reasoning-delta", delta: "考え中" },
      { type: "turn", finishReason: "stop" },
      {
        type: "done",
        result: {
          reason: "stop",
          messages: [],
          usage: { inputTokens: 0, outputTokens: 0 },
        },
      },
    ];

    const code = await showRun(
      fakeStart(events, { sessionId: "s-2" }),
      {
        stdout,
        stderr,
        term: noColor,
      },
    );

    expect(out()).toBe("✅ sessionId: s-2\n");
    expect(err()).toBe("");
    expect(code).toBe(0);
  });

  test("on failure, ends stdout's line and writes the error chain to stderr with exit code 1", async () => {
    const { stdout, stderr, out, err } = capture();
    const inner = new TypeError("inner");
    const outer = new Error("outer", { cause: inner });
    const events: HarnessEvent[] = [
      { type: "text-delta", delta: "途中" },
    ];

    const code = await showRun(fakeStart(events, { error: outer }), {
      stdout,
      stderr,
      term: noColor,
    });

    expect(out()).toBe("途中\n");
    expect(err()).toBe("❌ Error: outer ← TypeError: inner\n");
    expect(code).toBe(1);
  });
});

describe("describeError", () => {
  test("names an error with a string kind in parentheses, and leaves a non-string kind unparenthesized", () => {
    const withKind = new Error("c9");
    withKind.name = "ExtractorContractError";
    (withKind as unknown as { kind: unknown }).kind =
      "unknown-counterpart";
    expect(describeError(withKind)).toBe(
      "ExtractorContractError(unknown-counterpart): c9",
    );

    const numericKind = new Error("c9");
    (numericKind as unknown as { kind: unknown }).kind = 3;
    expect(describeError(numericKind)).toBe("Error: c9");
  });

  test("writes a non-error cause as JSON, and a string cause as a JSON string", () => {
    const withObjectCause = new Error("Extraction failed", {
      cause: {
        success: false,
        error: { issues: [{ code: "invalid_value" }] },
      },
    });
    withObjectCause.name = "ExtractorError";
    expect(describeError(withObjectCause)).toBe(
      'ExtractorError: Extraction failed ← {"success":false,"error":{"issues":[{"code":"invalid_value"}]}}',
    );

    const withStringCause = new Error("a", { cause: "boom" });
    expect(describeError(withStringCause)).toBe('Error: a ← "boom"');
  });

  test("falls back to a marked string for a cause JSON.stringify cannot handle", () => {
    const withBigIntCause = new Error("a", { cause: 1n });
    expect(describeError(withBigIntCause)).toBe(
      "Error: a ← <JSON にできない値: 1>",
    );

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const withCircularCause = new Error("a", { cause: circular });
    expect(describeError(withCircularCause)).toBe(
      "Error: a ← <JSON にできない値: [object Object]>",
    );

    expect(describeError(undefined)).toBe(
      "<JSON にできない値: undefined>",
    );
  });

  test("marks a repeated error in the cause chain, and turns a real newline in a message into the two characters", () => {
    const a = new Error("a");
    const b = new Error("b", { cause: a });
    a.cause = b;
    expect(describeError(a)).toBe("Error: a ← Error: b ← (循環)");

    const withNewline = new Error("x\ny");
    expect(describeError(withNewline)).toBe("Error: x\\ny");
  });
});
