import type { ConversationEntry, StoredToolCall } from "./types.js";

export const collectToolCalls = (
  entries: readonly ConversationEntry[],
): StoredToolCall[] =>
  entries.flatMap((entry, position) =>
    entry.messages.flatMap((message) =>
      message.role === "assistant"
        ? message.parts.flatMap((part) =>
            part.type === "tool-call"
              ? [{ id: part.id, position }]
              : [],
          )
        : [],
    ),
  );
