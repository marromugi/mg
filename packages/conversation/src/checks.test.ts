import { describe, expect, test } from "vitest";
import { assertJsonEntry, assertToolPairing } from "./checks.js";
import { EntryNotJsonError, EntryToolPairingError } from "./errors.js";
import type {
  ConversationEntry,
  ConversationMessage,
} from "./types.js";

const thrown = (fn: () => void): unknown => {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected the function to throw");
};

const userMessage = (): ConversationMessage => ({
  role: "user",
  content: "hi",
});

const toolCallMessage = (
  ...calls: Array<{ id: string; name: string; arguments: unknown }>
): ConversationMessage => ({
  role: "assistant",
  parts: calls.map((call) => ({ type: "tool-call", ...call })),
});

const toolResultMessage = (
  toolCallId: string,
): ConversationMessage => ({
  role: "tool",
  toolCallId,
  content: "pong",
});

const entryWithMessages = (
  messages: ConversationEntry["messages"],
): ConversationEntry => ({ messages });

const entryWithCall = (): ConversationEntry =>
  entryWithMessages([
    userMessage(),
    toolCallMessage({
      id: "c1",
      name: "echo",
      arguments: { text: "ping" },
    }),
    toolResultMessage("c1"),
  ]);

const entryWithArguments = (args: unknown): ConversationEntry =>
  entryWithMessages([
    userMessage(),
    toolCallMessage({ id: "c1", name: "echo", arguments: args }),
    toolResultMessage("c1"),
  ]);

const entryWithoutCall = (): ConversationEntry =>
  entryWithMessages([
    userMessage(),
    {
      role: "assistant",
      parts: [{ type: "text", text: "hello" }],
    },
  ]);

const deepFreeze = <T>(value: T): T => {
  if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
};

describe("assertJsonEntry", () => {
  test("passes an entry with a paired tool call", () => {
    expect(assertJsonEntry(entryWithCall())).toBeUndefined();
  });

  test("passes an entry without any tool call", () => {
    expect(assertJsonEntry(entryWithoutCall())).toBeUndefined();
  });

  test("reports the path of a value that cannot survive a JSON round trip", () => {
    const entry = entryWithArguments({ text: "ping", at: new Date(0) });

    const error = thrown(() => assertJsonEntry(entry));

    expect(error).toBeInstanceOf(EntryNotJsonError);
    expect((error as EntryNotJsonError).path).toBe(
      "messages[1].parts[0].arguments.at",
    );
  });

  test.each([
    ["undefined", undefined],
    ["NaN", Number.NaN],
    ["negative zero", -0],
    ["a bigint", 10n],
    ["a function", () => 1],
  ])("reports a path holding %s", (_label, value) => {
    const entry = entryWithArguments({ a: value });

    const error = thrown(() => assertJsonEntry(entry));

    expect(error).toBeInstanceOf(EntryNotJsonError);
    expect((error as EntryNotJsonError).path).toBe(
      "messages[1].parts[0].arguments.a",
    );
  });

  test("reports the path of a value nested under reasoning carry data", () => {
    const entry = entryWithMessages([
      {
        role: "assistant",
        parts: [
          {
            type: "reasoning",
            text: "t",
            carry: {
              provider: "p",
              data: { list: [1, new Map()] },
            },
          },
        ],
      },
    ]);

    const error = thrown(() => assertJsonEntry(entry));

    expect(error).toBeInstanceOf(EntryNotJsonError);
    expect((error as EntryNotJsonError).path).toBe(
      "messages[0].parts[0].carry.data.list[1]",
    );
  });

  test("reports the first offending path when more than one value fails", () => {
    const entry = entryWithArguments({
      first: new Date(0),
      second: new Date(0),
    });

    const error = thrown(() => assertJsonEntry(entry));

    expect(error).toBeInstanceOf(EntryNotJsonError);
    expect((error as EntryNotJsonError).path).toBe(
      "messages[1].parts[0].arguments.first",
    );
  });

  test("reports a cycle where an object refers back to an ancestor object", () => {
    const nested: Record<string, unknown> = {};
    const args = { text: "ping", nested };
    nested.back = args;

    const error = thrown(() =>
      assertJsonEntry(entryWithArguments(args)),
    );

    expect(error).toBeInstanceOf(EntryNotJsonError);
    expect((error as EntryNotJsonError).kind).toBe("cycle");
    expect((error as EntryNotJsonError).path).toBe(
      "messages[1].parts[0].arguments.nested.back",
    );
  });

  test("reports a cycle where an array holds itself as an element", () => {
    const list: unknown[] = [1];
    list.push(list);
    const args = { list };

    const error = thrown(() =>
      assertJsonEntry(entryWithArguments(args)),
    );

    expect(error).toBeInstanceOf(EntryNotJsonError);
    expect((error as EntryNotJsonError).kind).toBe("cycle");
    expect((error as EntryNotJsonError).path).toBe(
      "messages[1].parts[0].arguments.list[1]",
    );
  });

  test("passes the same object referenced from two different paths", () => {
    const shared = { x: 1 };
    const args = { a: shared, b: shared };

    expect(assertJsonEntry(entryWithArguments(args))).toBeUndefined();
  });

  test("reports a value that cannot survive a JSON round trip even when it also refers back to an ancestor", () => {
    const args: Record<string, unknown> = { at: new Date(0) };
    args.self = args;

    const error = thrown(() =>
      assertJsonEntry(entryWithArguments(args)),
    );

    expect(error).toBeInstanceOf(EntryNotJsonError);
    expect((error as EntryNotJsonError).kind).toBe("not-json");
    expect((error as EntryNotJsonError).path).toBe(
      "messages[1].parts[0].arguments.at",
    );
  });
});

describe("assertToolPairing", () => {
  test("passes an entry with a paired tool call", () => {
    expect(assertToolPairing(entryWithCall())).toBeUndefined();
  });

  test("passes an entry without any tool call", () => {
    expect(assertToolPairing(entryWithoutCall())).toBeUndefined();
  });

  test("reports the call that has no result", () => {
    const [user, call] = entryWithCall().messages;
    const entry = entryWithMessages([user, call]);

    const error = thrown(() => assertToolPairing(entry));

    expect(error).toBeInstanceOf(EntryToolPairingError);
    expect((error as EntryToolPairingError).kind).toBe(
      "unanswered-call",
    );
    expect((error as EntryToolPairingError).toolCallId).toBe("c1");
  });

  test("reports the result that has no call before it", () => {
    const [user, call, result] = entryWithCall().messages;
    const entry = entryWithMessages([user, result, call]);

    const error = thrown(() => assertToolPairing(entry));

    expect(error).toBeInstanceOf(EntryToolPairingError);
    expect((error as EntryToolPairingError).kind).toBe("orphan-result");
    expect((error as EntryToolPairingError).toolCallId).toBe("c1");
  });

  test("reports a second result for the same call", () => {
    const messages = entryWithCall().messages;
    const entry = entryWithMessages([...messages, messages[2]]);

    const error = thrown(() => assertToolPairing(entry));

    expect(error).toBeInstanceOf(EntryToolPairingError);
    expect((error as EntryToolPairingError).kind).toBe("orphan-result");
    expect((error as EntryToolPairingError).toolCallId).toBe("c1");
  });

  test("reports the first unanswered call when more than one is open", () => {
    const entry = entryWithMessages([
      toolCallMessage(
        { id: "c1", name: "echo", arguments: {} },
        { id: "c2", name: "echo", arguments: {} },
      ),
      toolResultMessage("c2"),
    ]);

    const error = thrown(() => assertToolPairing(entry));

    expect(error).toBeInstanceOf(EntryToolPairingError);
    expect((error as EntryToolPairingError).kind).toBe(
      "unanswered-call",
    );
    expect((error as EntryToolPairingError).toolCallId).toBe("c1");
  });

  test("reports a duplicate call when the same id appears twice in one message", () => {
    const entry = entryWithMessages([
      userMessage(),
      toolCallMessage(
        { id: "c1", name: "echo", arguments: { text: "ping" } },
        { id: "c1", name: "echo", arguments: { text: "ping" } },
      ),
      toolResultMessage("c1"),
    ]);

    const error = thrown(() => assertToolPairing(entry));

    expect(error).toBeInstanceOf(EntryToolPairingError);
    expect((error as EntryToolPairingError).kind).toBe(
      "duplicate-call",
    );
    expect((error as EntryToolPairingError).toolCallId).toBe("c1");
  });

  test("reports a duplicate call even when the earlier call already has a result", () => {
    const entry = entryWithMessages([
      userMessage(),
      toolCallMessage({
        id: "c1",
        name: "echo",
        arguments: { text: "ping" },
      }),
      toolResultMessage("c1"),
      toolCallMessage({
        id: "c1",
        name: "echo",
        arguments: { text: "ping" },
      }),
    ]);

    const error = thrown(() => assertToolPairing(entry));

    expect(error).toBeInstanceOf(EntryToolPairingError);
    expect((error as EntryToolPairingError).kind).toBe(
      "duplicate-call",
    );
    expect((error as EntryToolPairingError).toolCallId).toBe("c1");
  });

  test("reports an orphan result that comes before a later duplicate call", () => {
    const entry = entryWithMessages([
      userMessage(),
      toolCallMessage({
        id: "c1",
        name: "echo",
        arguments: { text: "ping" },
      }),
      toolResultMessage("c2"),
      toolCallMessage({
        id: "c1",
        name: "echo",
        arguments: { text: "ping" },
      }),
    ]);

    const error = thrown(() => assertToolPairing(entry));

    expect(error).toBeInstanceOf(EntryToolPairingError);
    expect((error as EntryToolPairingError).kind).toBe("orphan-result");
    expect((error as EntryToolPairingError).toolCallId).toBe("c2");
  });

  test("reports a duplicate call found in an earlier message before a later orphan result", () => {
    const entry = entryWithMessages([
      userMessage(),
      toolCallMessage(
        { id: "c1", name: "echo", arguments: { text: "ping" } },
        { id: "c1", name: "echo", arguments: { text: "ping" } },
      ),
      toolResultMessage("c9"),
    ]);

    const error = thrown(() => assertToolPairing(entry));

    expect(error).toBeInstanceOf(EntryToolPairingError);
    expect((error as EntryToolPairingError).kind).toBe(
      "duplicate-call",
    );
    expect((error as EntryToolPairingError).toolCallId).toBe("c1");
  });

  test("passes an entry with two different calls in one message each paired with a result", () => {
    const entry = entryWithMessages([
      userMessage(),
      toolCallMessage(
        { id: "c1", name: "echo", arguments: { text: "ping" } },
        { id: "c2", name: "echo", arguments: { text: "ping" } },
      ),
      toolResultMessage("c1"),
      toolResultMessage("c2"),
    ]);

    expect(assertToolPairing(entry)).toBeUndefined();
  });
});

describe("checks on a frozen entry", () => {
  test("do not modify the entry", () => {
    const entry = deepFreeze(entryWithCall());

    expect(() => assertJsonEntry(entry)).not.toThrow();
    expect(() => assertToolPairing(entry)).not.toThrow();
  });
});
