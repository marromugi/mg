# @mg/memory

A package of interfaces and types for saving and returning a persona's
memory.

A persona is an agent that has a personality and holds conversations.
Memory is kept separately for each persona.

## Features

- Defines the types for the 3 kinds of memory.
- Defines the types for a read selection, a write change, and a write's
  return value.
- Defines `MemoryStore`, the interface for saving memory.
- Has dedicated errors used by the stores.
- Has `createMemoryStore`, an in-memory store that implements `MemoryStore`.
- Has `openSqliteMemoryStore`, a SQLite store that implements `MemoryStore`.

## Usage

Create a store, create a persona's memory, write an item, then read it back.

```ts
import { createMemoryStore } from "@mg/memory";

const store = createMemoryStore();
await store.create("jev", "I am Jev.");
await store.write("jev", { add: [item] });
const view = await store.read("jev", { counterparts: ["alice"] });
```

The SQLite store is used the same way.

```ts
import { openSqliteMemoryStore } from "@mg/memory/sqlite";

const store = await openSqliteMemoryStore("path/to/memory.db");
await store.create("jev", "I am Jev.");
await store.write("jev", { add: [item] });
const view = await store.read("jev", { counterparts: ["alice"] });
await store.close();
```

The SQLite store also has `close()`.
Call it when you no longer need the store.

## API

### The three kinds of memory

There are 3 kinds of memory.
Each has its own type.

| Type                  | What it remembers                       | What it holds                         |
| --------------------- | --------------------------------------- | ------------------------------------- |
| `PersonaDocument`     | The persona's own personality document  | Text `text` and version `version`     |
| `ConversationSummary` | The summary of one conversation         | Text `text` and version `version`     |
| `MemoryItem`          | One item remembered about a counterpart | id, counterpart id, text, time, count |

A `MemoryItem` has an id, the counterpart's id `counterpart`, and text
`text`.
It also has the time it was created, `createdAt`, and the number of times it
was not chosen, `misses`.

The personality document and the conversation summary have versions.
Items do not have versions.

### `MemoryStore`

The table lists the interface's operations.

| Operation | What it does                                                                    |
| --------- | ------------------------------------------------------------------------------- |
| `create`  | Takes a persona id and the personality document's text, and creates its memory. |
| `read`    | Takes a persona id and a selection, and returns part of the memory.             |
| `write`   | Takes a persona id and a change, and rewrites the memory.                       |
| `delete`  | Takes a persona id and a list of item ids, and deletes those items.             |

The read selection type is `MemorySelection`.
It has the list of counterpart ids `counterparts` and an optional
conversation id `conversation`.

The read return type is `MemoryView`.
It has the personality document `persona`, the list of items `items`, and an
optional conversation summary `summary`.

The write change type is `MemoryChange`.
It has these 5 fields, each optional.

- `persona`: the personality document's new text and the version at the time
  of reading
- `summary`: the conversation summary's new text, the conversation id, and
  the version at the time of reading
- `add`: the list of items to add. The item type is `NewMemoryItem`, which has
  no `misses`
- `hits`: the list of ids of items that were chosen
- `misses`: the list of ids of items that were not chosen

The write return type is `MissCounts`.
It is a plain object keyed by the ids of items not chosen, holding each
count after the write.

### Errors

The table lists the exceptions thrown.

| Exception                 | Thrown when                                                    |
| ------------------------- | -------------------------------------------------------------- |
| `PersonaExistsError`      | Creating with an id that already exists                        |
| `PersonaNotFoundError`    | Handling a persona that was never created                      |
| `MemoryConflictError`     | The personality or summary version differs from the actual one |
| `MemoryItemExistsError`   | The id of an item to add already exists                        |
| `MemoryItemNotFoundError` | A given item id is not in the store                            |
| `MemoryArgumentError`     | An argument is wrong                                           |

`PersonaExistsError` and `PersonaNotFoundError` have the persona id
`personaId`.

`MemoryConflictError` has the persona id `personaId` and the list of
mismatched entries `mismatches`.
Each entry in `mismatches` has a kind `kind` (`persona` or `summary`), an
optional key `key`, the given version `expectedVersion`, and the actual
version `actualVersion`.

`MemoryItemExistsError` and `MemoryItemNotFoundError` have the persona id
`personaId` and the list of target item ids `itemIds`.

`MemoryArgumentError` has a kind `kind` and a detailed description `detail`.
There are 8 kinds.

- `empty-id`: an id is empty
- `empty-text`: a text is empty
- `duplicate-id`: an id is duplicated within a list
- `hit-and-miss`: the same id is in both the chosen and the not-chosen items
- `empty-change`: all 5 fields of the change are left out or empty
- `invalid-version`: a version is not an integer of 0 or more
- `invalid-time`: a creation time is not a finite number
- `empty-list`: the list of items to delete is empty

Every exception has its own name in `name`.

## How it works

### The promise for concurrent calls

Operations on one store give the same results even when called at the same
time.
The result is the same as running them one at a time in the order they were
called.
This is a promise of `MemoryStore`.
Every implementation keeps this promise.

- When concurrent writes pass the same version, the one called first writes.
  The later one fails with a conflict error.
- When the items touched do not overlap and the versions match, concurrent
  writes are both saved.
- A read called after a write reads the result of that write.

This promise covers calls to one store.
Any wider scope is decided by each implementation.
Each implementation writes its scope into this document.

### In-memory store

`createMemoryStore` is an implementation of `MemoryStore` that lives only
inside the process.

It takes no arguments.
Each call returns a new store with no memory.

Saved memory is gone when the process ends.
Stores created separately do not share memory.

### SQLite store

This implements `MemoryStore` with SQLite.
Its name is `openSqliteMemoryStore`.
It is exported from an entry point separate from the main entry point of
`@mg/memory`.

The argument is the path of the file to open.
If the store's directory does not exist, it is created.
If the tables do not exist, they are created.

Passing `":memory:"` as the path opens it without creating a file.

Opening the same path again lets you read the memory saved before.
As long as the file remains, memory survives across processes.

When the store cannot be opened, the open function rejects with that error.
No store is returned.

#### Closing the store

`openSqliteMemoryStore` returns a `SqliteMemoryStore`.
It is a `MemoryStore` that also has `close()`.

```ts
await store.close();
```

- `close()` waits for the calls already made on this store.
  What they wrote stays in the file.
- After that, it releases this store's connections to the file.
  The file's descriptors are freed a short time after `close()` resolves.
- `close()` resolves to `undefined` and never rejects.
- Once `close()` has been called, even before it resolves, `create`, `read`,
  `write` and `delete` reject with `MemoryStoreClosedError`.
  They do not check their arguments and do not reach the file.
  Its `name` is `"MemoryStoreClosedError"`.
  Its message is `The memory store is closed. Open it again to keep using it.`
- Calling `close()` again resolves to `undefined` once the first `close()`
  has resolved.
- Closing one store does not affect another store opened on the same file.

`SqliteMemoryStore` and `MemoryStoreClosedError` are exported from the SQLite
entry point only.

The library that talks to SQLite is loaded only inside this entry point.
It is not loaded from the main entry point of `@mg/memory`.

#### What concurrent calls are covered

This implementation widens the promise for concurrent calls.
The promise also covers stores in the same process that opened the same
file.

- Within the same process, operations on the same file run one at a time in
  order. The migration inside the open function is included.
- Whether it is the same file is told by the file's device and inode.
  Even if opened under a different name, it is covered when it points at the
  same file. This covers symbolic links, hard links, and names that differ
  only in case.
- A store opened with `":memory:"` is a separate store each time it is
  opened. Calls run one at a time only within that store.
- Even if an earlier operation fails, operations called later still run in
  order.

Contention beyond this scope is outside the promise.
The file belongs to this store alone.
Sharing the file with a different kind of store is not supported.
If shared, the other side may write in the middle of a memory write.
That other side then fails on its next wait.

Another process may hold the write lock on the same file.
In that case, it fails with SQLite's busy error after waiting 5 seconds.
That error reaches the caller as is.

## Non-goals

- It has no rules for forgetting.
  The caller decides the count limit and the per-counterpart item limit.
- It does not depend on other packages in this repository.
