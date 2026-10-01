import { describe, expect, test } from "vitest";
import { findToolPairingProblem } from "./pairing.js";
import type { AssistantMessage, Message } from "./types.js";

const call = (id: string): AssistantMessage => ({
  role: "assistant",
  parts: [{ type: "tool-call", id, name: "echo", arguments: {} }],
});

const result = (toolCallId: string): Message => ({
  role: "tool",
  toolCallId,
  content: "ok",
});

describe("findToolPairingProblem", () => {
  test("returns nothing when every call has one result after it", () => {
    expect(
      findToolPairingProblem([
        { role: "user", content: "hi" },
        call("a"),
        result("a"),
        call("b"),
        result("b"),
      ]),
    ).toBeUndefined();
  });

  test("reports an id used by two calls as duplicate-call", () => {
    expect(
      findToolPairingProblem([
        call("a"),
        result("a"),
        call("a"),
        result("a"),
      ]),
    ).toEqual({ kind: "duplicate-call", toolCallId: "a" });
  });

  test("reports a result with no call before it as orphan-result", () => {
    expect(findToolPairingProblem([result("a"), call("a")])).toEqual({
      kind: "orphan-result",
      toolCallId: "a",
    });
  });

  test("reports a call with no result as unanswered-call", () => {
    expect(findToolPairingProblem([call("a")])).toEqual({
      kind: "unanswered-call",
      toolCallId: "a",
    });
  });

  test("reports the first problem in message order", () => {
    expect(
      findToolPairingProblem([call("a"), result("b"), call("a")]),
    ).toEqual({ kind: "orphan-result", toolCallId: "b" });
  });
});
