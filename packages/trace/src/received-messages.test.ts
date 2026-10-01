import { describe, expect, it } from "vitest";
import { receivedMessagesOf } from "./received-messages.js";

const OUT = "mg.llm.messages.output";

const withOutput = (output: unknown) => ({
  attributes: { [OUT]: JSON.stringify(output) },
  events: [],
});

describe("receivedMessagesOf", () => {
  it("returns assistant messages in the current form", () => {
    const messages = [
      {
        role: "assistant",
        parts: [{ type: "text", text: "hi" }],
      },
    ];
    expect(receivedMessagesOf(withOutput(messages))).toEqual({
      kind: "messages",
      messages,
    });
  });

  it("converts the older assistant form to parts", () => {
    expect(
      receivedMessagesOf(
        withOutput([
          {
            role: "assistant",
            content: "hi",
            toolCalls: [
              { id: "c1", name: "bash", arguments: { cmd: "ls" } },
            ],
          },
        ]),
      ),
    ).toEqual({
      kind: "messages",
      messages: [
        {
          role: "assistant",
          parts: [
            { type: "text", text: "hi" },
            {
              type: "tool-call",
              id: "c1",
              name: "bash",
              arguments: { cmd: "ls" },
            },
          ],
        },
      ],
    });
  });

  it("reads an empty array as no messages", () => {
    expect(receivedMessagesOf(withOutput([]))).toEqual({
      kind: "messages",
      messages: [],
    });
  });

  it("says the output is missing when there is no attribute", () => {
    expect(receivedMessagesOf({ attributes: {}, events: [] })).toEqual({
      kind: "unreadable",
      reason: "output messages are missing",
    });
  });

  it("says the output is not a JSON array", () => {
    expect(
      receivedMessagesOf({
        attributes: { [OUT]: "{}" },
        events: [],
      }),
    ).toEqual({
      kind: "unreadable",
      reason: "output messages are not a JSON array",
    });
  });

  it("names the position of a message that is not an assistant message", () => {
    expect(
      receivedMessagesOf(
        withOutput([
          { role: "assistant", parts: [] },
          { role: "user", content: "x" },
        ]),
      ),
    ).toEqual({
      kind: "unreadable",
      reason: "output message at 1 is not an assistant message",
    });
  });
});
