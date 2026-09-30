import { describe, expect, it } from "vitest";
import { sentMessagesOf, type RecordedSpan } from "./sent-messages.js";

const IN = "mg.llm.messages.input";
const COUNT = "mg.llm.system.count";
const SYS = "mg.llm.system";
const CONTENT = "mg.llm.system.content";
const INDEX = "mg.llm.system.index";

const user = { role: "user", content: "a" };

const span = (
  attributes: Record<string, unknown>,
  events: RecordedSpan["events"] = [],
): RecordedSpan => ({ attributes, events });

const withInput = (
  input: unknown,
  extra: Record<string, unknown> = {},
  events: RecordedSpan["events"] = [],
) => span({ [IN]: JSON.stringify(input), ...extra }, events);

const unreadable = (reason: string) => ({ kind: "unreadable", reason });

describe("sentMessagesOf", () => {
  it("returns the input attribute as is when there is no count and no events", () => {
    expect(
      sentMessagesOf(
        withInput([
          { role: "system", content: "s" },
          { role: "user", content: "hi" },
        ]),
      ),
    ).toEqual({
      kind: "messages",
      messages: [
        { role: "system", content: "s" },
        { role: "user", content: "hi" },
      ],
    });
  });

  it("puts each system event at its index and fills the rest from the input", () => {
    const assistant = {
      role: "assistant",
      parts: [{ type: "text", text: "A" }],
    };
    expect(
      sentMessagesOf(
        withInput([user, assistant], { [COUNT]: 2 }, [
          { name: SYS, attributes: { [CONTENT]: "late", [INDEX]: 2 } },
          { name: SYS, attributes: { [CONTENT]: "first", [INDEX]: 0 } },
        ]),
      ),
    ).toEqual({
      kind: "messages",
      messages: [
        { role: "system", content: "first" },
        user,
        { role: "system", content: "late" },
        assistant,
      ],
    });
  });

  it("ignores events with other names", () => {
    expect(
      sentMessagesOf(
        withInput([user], { [COUNT]: 0 }, [
          { name: "other", attributes: {} },
        ]),
      ),
    ).toEqual({ kind: "messages", messages: [user] });
  });

  it("converts the older assistant form to parts", () => {
    expect(
      sentMessagesOf(
        withInput([
          {
            role: "assistant",
            content: "ok",
            toolCalls: [{ id: "c1", name: "ls", arguments: {} }],
          },
          { role: "assistant", content: "" },
        ]),
      ),
    ).toEqual({
      kind: "messages",
      messages: [
        {
          role: "assistant",
          parts: [
            { type: "text", text: "ok" },
            { type: "tool-call", id: "c1", name: "ls", arguments: {} },
          ],
        },
        { role: "assistant", parts: [] },
      ],
    });
  });

  it("says why the input attribute cannot be read", () => {
    expect(sentMessagesOf(span({}))).toEqual(
      unreadable("input messages are missing"),
    );
    expect(sentMessagesOf(span({ [IN]: 3 }))).toEqual(
      unreadable("input messages are missing"),
    );
    expect(sentMessagesOf(span({ [IN]: "{" }))).toEqual(
      unreadable("input messages are not a JSON array"),
    );
    expect(sentMessagesOf(withInput({ role: "user" }))).toEqual(
      unreadable("input messages are not a JSON array"),
    );
    expect(sentMessagesOf(withInput([user, 3]))).toEqual(
      unreadable("input message at 1 is not a message"),
    );
    expect(sentMessagesOf(withInput([{ role: "user" }]))).toEqual(
      unreadable("input message at 0 is not a message"),
    );
  });

  it("does not accept an older assistant form with malformed tool calls", () => {
    expect(
      sentMessagesOf(
        withInput([
          {
            role: "assistant",
            content: "ok",
            toolCalls: [{ id: 1, name: "ls" }],
          },
        ]),
      ),
    ).toEqual(unreadable("input message at 0 is not a message"));
    expect(
      sentMessagesOf(
        withInput([
          { role: "assistant", content: "ok", toolCalls: "ls" },
        ]),
      ),
    ).toEqual(unreadable("input message at 0 is not a message"));
  });

  it("is unreadable when a system message sits in the input of a span with a count", () => {
    expect(
      sentMessagesOf(
        withInput([user, { role: "system", content: "s" }], {
          [COUNT]: 0,
        }),
      ),
    ).toEqual(
      unreadable(
        "input message at 1 is a system message, but the span records system messages as events",
      ),
    );
  });

  it("says which system event is malformed", () => {
    const one = (attributes: Record<string, unknown>) =>
      sentMessagesOf(
        withInput([user], { [COUNT]: 1 }, [{ name: SYS, attributes }]),
      );
    expect(one({ [INDEX]: 0 })).toEqual(
      unreadable("system event 0 has no text content"),
    );
    expect(one({ [CONTENT]: "s", [INDEX]: -1 })).toEqual(
      unreadable("system event 0 has no valid index"),
    );
    expect(one({ [CONTENT]: "s", [INDEX]: 1.5 })).toEqual(
      unreadable("system event 0 has no valid index"),
    );
    expect(one({ [CONTENT]: "s", [INDEX]: "0" })).toEqual(
      unreadable("system event 0 has no valid index"),
    );
    expect(one({ [CONTENT]: "s", [INDEX]: 5 })).toEqual(
      unreadable("system event index 5 is outside the 2 sent messages"),
    );
    expect(
      sentMessagesOf(
        withInput([user], { [COUNT]: 2 }, [
          { name: SYS, attributes: { [CONTENT]: "s", [INDEX]: 0 } },
          { name: SYS, attributes: { [CONTENT]: "t", [INDEX]: 0 } },
        ]),
      ),
    ).toEqual(unreadable("two system events have index 0"));
  });

  it("compares the count with the events", () => {
    const event = {
      name: SYS,
      attributes: { [CONTENT]: "s", [INDEX]: 0 },
    };
    expect(
      sentMessagesOf(withInput([user], { [COUNT]: 2 }, [event])),
    ).toEqual(unreadable("expected 2 system events, found 1"));
    expect(sentMessagesOf(withInput([user], {}, [event]))).toEqual(
      unreadable(
        "system events are recorded but the system count is missing",
      ),
    );
  });
});
