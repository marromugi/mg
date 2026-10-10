import type { MemoryOutcome } from "@mg/runner";
import { JudgeError } from "@mg/turn";
import { describe, expect, test } from "vitest";
import {
  judgeFailureLine,
  memoryLine,
  memoryLines,
  replyLines,
} from "./outcome-lines.ts";

describe("memoryLines", () => {
  test("writes the memory result as one JSON line when the update succeeded", () => {
    const memory: MemoryOutcome<unknown> = {
      updated: true,
      added: ["m1"],
      personaChanged: false,
      forgotten: [],
    };

    expect(memoryLines(memory)).toEqual([
      '  memory: {"updated":true,"added":["m1"],"personaChanged":false,"forgotten":[]}',
    ]);
  });

  test("writes the reason and the error chain, without the request, when the reason could not be decided", () => {
    const error = new Error("Extraction failed", {
      cause: {
        success: false,
        error: { issues: [{ code: "invalid_value" }] },
      },
    });
    error.name = "ExtractorError";
    const memory: MemoryOutcome<unknown> = {
      updated: false,
      reason: "undecided",
      error,
      request: {
        read: "READ-MARK",
        entry: [{ role: "user", content: "ENTRY-MARK" }],
      },
    };

    const lines = memoryLines(memory);

    expect(lines).toEqual([
      "  reason: undecided",
      '  error: ExtractorError: Extraction failed ← {"success":false,"error":{"issues":[{"code":"invalid_value"}]}}',
    ]);
    expect(lines.join("\n")).not.toContain("READ-MARK");
    expect(lines.join("\n")).not.toContain("ENTRY-MARK");
  });

  test("writes the reason and the error chain when the write failed", () => {
    const memory: MemoryOutcome<unknown> = {
      updated: false,
      reason: "write-failed",
      error: new Error("disk full"),
    };

    expect(memoryLines(memory)).toEqual([
      "  reason: write-failed",
      "  error: Error: disk full",
    ]);
  });

  test("writes the reason and the error chain when the update was rejected", () => {
    const memory: MemoryOutcome<unknown> = {
      updated: false,
      reason: "rejected",
      error: "boom",
    };

    expect(memoryLines(memory)).toEqual([
      "  reason: rejected",
      '  error: "boom"',
    ]);
  });

  test("writes the added, changed, and pending items when cleanup failed", () => {
    const memory: MemoryOutcome<unknown> = {
      updated: false,
      reason: "forget-failed",
      error: new Error("locked"),
      added: ["m1", "m2"],
      personaChanged: true,
      pending: ["m0"],
    };

    expect(memoryLines(memory)).toEqual([
      "  reason: forget-failed",
      "  error: Error: locked",
      '  added: ["m1","m2"]',
      "  personaChanged: true",
      '  pending: ["m0"]',
    ]);
  });
});

describe("judgeFailureLine", () => {
  test("writes the judge name and the error chain on one line", () => {
    const error = new JudgeError("stop", "no answer", {
      cause: new Error("timeout"),
    });

    expect(judgeFailureLine("stop", error)).toBe(
      "stop: JudgeError: no answer ← Error: timeout",
    );
  });
});

describe("replyLines", () => {
  test("writes the text of the last assistant message as one reply line", () => {
    expect(
      replyLines([
        { role: "user", content: "hi" },
        { role: "assistant", parts: [{ type: "text", text: "first" }] },
        { role: "user", content: "again" },
        {
          role: "assistant",
          parts: [{ type: "text", text: "second" }],
        },
      ]),
    ).toEqual(["  reply: second"]);
  });

  test("writes no line when the run produced no assistant text", () => {
    expect(replyLines([{ role: "user", content: "hi" }])).toEqual([]);
  });
});

describe("memoryLine", () => {
  test("writes the memory result as one JSON line when the update succeeded", () => {
    expect(
      memoryLine({
        updated: true,
        added: ["m1"],
        personaChanged: false,
        forgotten: [],
      }),
    ).toBe(
      'memory: {"updated":true,"added":["m1"],"personaChanged":false,"forgotten":[]}',
    );
  });

  test("writes the reason on one line when memory was not updated", () => {
    expect(
      memoryLine({
        updated: false,
        reason: "write-failed",
        error: new Error("disk"),
      }),
    ).toMatch(/^memory: not updated \(write-failed: .*disk.*\)$/);
  });
});
