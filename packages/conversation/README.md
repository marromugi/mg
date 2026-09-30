# @mg/conversation

A base package for saving conversations and reading them back later.

A conversation is the list of messages one agent exchanges with an LLM.
Conversations are told apart by id.

The unit of saving is what one run added.
This is called an "entry".

## Features

- Defines the type of a conversation message.
  It is core's message type itself.
- Defines the type of an entry.
  An entry holds one or more messages.
- Defines the type of a read range.
  A range is either "all" or "the last n".
- Defines the type of a read result.
  The result holds the list of entries and the total number of entries in
  that conversation.
- Defines `ConversationStore`, the interface for saving conversations.
  It has 3 operations: create, read and append.
- Has dedicated errors used by the stores and the checks.
- Has 2 check functions to use before appending.
- Has 2 implementations of `ConversationStore`.
  One lives only inside the process, the other uses SQLite.

## Usage

Create a store, create a conversation, append an entry, then read it back.

```ts
import { createMemoryConversationStore } from "@mg/conversation";

const store = createMemoryConversationStore();
await store.create("jev");
await store.append("jev", entry, 0);
const slice = await store.read("jev", { kind: "all" });
```

The SQLite store is used the same way.

```ts
import { openSqliteConversationStore } from "@mg/conversation/sqlite";

const store = await openSqliteConversationStore(
  "path/to/conversations.db",
);
await store.create("jev");
await store.append("jev", entry, 0);
const slice = await store.read("jev", { kind: "all" });
```

## API

### `ConversationStore`

The table lists the interface's operations.

| Operation | What it does                                                            |
| --------- | ----------------------------------------------------------------------- |
| `create`  | Takes an id and creates a conversation with 0 entries.                  |
| `read`    | Takes an id and a range, and returns the list of entries and the total. |
| `append`  | Takes an id, one entry, and the total at the time of reading.           |

The total passed to `append` is the total number of entries at the time of
reading.
If it differs from the actual total in the store, the append fails.

### The two checks

There are 2 functions to use before appending.
Neither changes the entry passed in.
They take neither the store nor the conversation id, and look only at the
entry.

The table lists what each function checks.

| Function            | What it checks                                                 |
| ------------------- | -------------------------------------------------------------- |
| `assertJsonEntry`   | Whether the entry's value stays the same through JSON and back |
| `assertToolPairing` | Whether tool calls and results come in pairs                   |

If there is no problem, neither returns anything.
If there is a problem, they throw a dedicated error.

`assertJsonEntry` lets through strings, booleans and null.
Numbers that are finite and not -0 also pass.
Arrays of these, and plain objects with these as values, also pass.
When it finds any other value, it throws `EntryNotJsonError`.
The location is a string that starts with `messages`.
Array indexes are joined as `[n]`, and object keys as `.key`.

A value can contain a reference back to an object or array that contains it.
At that reference, it throws `EntryNotJsonError` of the cycle kind.
A containing value is one on the path from the current value up to the root.

A reference to the same object that is not on that path is let through.
References from separate places show up as the same value in JSON too.

An entry that `assertToolPairing` lets through meets these conditions.

- Call ids are not duplicated within the same entry.
- Every call has a result with the same id after it.
- Every result has a call with the same id before it.

Entries that use no tools also pass.

If they are not paired, it throws `EntryToolPairingError`.
It throws the same error when it finds a duplicated call.
The error happens as soon as a second call with the same id appears.
It does not matter whether a result came first.

### Errors

The table lists the exceptions thrown.

| Exception                          | Thrown when                                                    |
| ---------------------------------- | -------------------------------------------------------------- |
| `ConversationExistsError`          | Creating with an id that already exists                        |
| `ConversationNotFoundError`        | Reading or appending with an id that was never created         |
| `ConversationRangeError`           | The range's count is not a positive integer                    |
| `ConversationConflictError`        | The total passed differs from the actual total in the store    |
| `ConversationEntryUnreadableError` | A stored entry cannot be read back                             |
| `EntryNotJsonError`                | The entry's value does not stay the same through JSON and back |
| `EntryToolPairingError`            | Tool calls and results do not come in pairs within the entry   |

`ConversationExistsError` and `ConversationNotFoundError` have the id
`conversationId`.

`ConversationRangeError` has the given count `count`.

`ConversationConflictError` has `conversationId`, the given total
`expectedLength`, and the actual total `actualLength`.

`ConversationEntryUnreadableError` has `conversationId`, the 0-based
`position` of the lowest unreadable entry, and the original parse error in
`cause`.
Stores that keep entries outside memory throw it when a stored entry cannot
be turned back into an entry.

`EntryNotJsonError` has a kind `kind` and the location of the first value
found, `path`.
There are 2 kinds: a value that is not a JSON value, `not-json`, and a cycle,
`cycle`.

`EntryToolPairingError` has a kind `kind` and the tool call id `toolCallId`.
There are 3 kinds: a call with no result, `unanswered-call`, a result with no
call, `orphan-result`, and a duplicated call, `duplicate-call`.

Every exception has its own name in `name`.

## How it works

### How the types are split

The type of a conversation message is core's message type itself.
A system message can be assigned just like any other message.
System messages are also saved as is, at the position the run gave them.

The entry type `ConversationEntry` holds one or more messages.
An entry with 0 messages does not pass the type check.

The read range type `ReadRange` has no default.
The read operation cannot be called without a range.

### In-memory store

`createMemoryConversationStore` is an implementation of `ConversationStore`
that lives only inside the process.

It takes no arguments.
Each call returns a new store with no conversations.

Saved conversations are gone when the process ends.
Stores created separately do not share conversations.

### SQLite store

`openSqliteConversationStore` is an implementation of `ConversationStore`
that uses SQLite.
It is exported from an entry point separate from the main entry point of
`@mg/conversation`.

The argument is the path of the file to open.
If the store's directory does not exist, it is created.
If the tables do not exist, they are created.

Passing `":memory:"` as the path opens it without creating a file.

Opening the same path again lets you read the conversations saved before.
As long as the file remains, conversations survive across processes.

Even when 2 stores have the same path open at once, the total check still
works.
Only the side that appended first is kept.
The side that appended later fails with `ConversationConflictError`.

When a stored row is not valid JSON, reading the conversation rejects with
`ConversationEntryUnreadableError`.
It names the conversation and the lowest unreadable position.
A row that parses but is not a list of messages is not checked.

When the store cannot be opened, the open function rejects with that error.
No store is returned.

The library that talks to SQLite is loaded only inside this entry point.
It is not loaded from the main entry point of `@mg/conversation`.

## Non-goals

- It does not list, delete or name conversations.
- It does not keep times for entries.
- It does not choose ids.
  The caller chooses ids.
- It does not choose read ranges.
  The caller chooses ranges.
- It does not summarize conversations that grow long.
