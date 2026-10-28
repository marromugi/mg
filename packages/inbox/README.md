# @mg/inbox

A base package that holds input for an agent until it is due, and hands
each input over to a run function.

An input is a JSON value. It belongs to a conversation, which is told
apart by id. The inbox does not read the input, run agents, or hold keys.

## Features

- Defines `InboxStore`, the interface for keeping pending input and how
  each input ended.
  It has 4 operations: add, pending, settle and close.
- Delivers due input to the run function you give it.
  Within one conversation, input runs one at a time, ordered by due time
  and then by when it was added.
  Conversations do not wait for each other.
- Arms one timer for the earliest future due time.
  The clock (`now` and `setTimer`) can be replaced.
- Keeps an input pending until its run settles.
  If the process stops mid-run, the input runs again after reopening.
  Delivery is at least once.
- Marks an input failed, with the error message, when its run throws.
  A failed input is not run again, and the conversation moves on.
- Has 2 implementations of `InboxStore`.
  One lives only inside the process, the other uses SQLite.

## Usage

Open a store, create an inbox on it, start it, then add input.

```ts
import { createInbox } from "@mg/inbox";
import { openSqliteInboxStore } from "@mg/inbox/sqlite";

const store = await openSqliteInboxStore("./inbox.db");
const inbox = createInbox({
  store,
  run: async (item) => {
    await talk(item.conversationId, item.input);
  },
});
await inbox.start();
await inbox.add("jev", "good morning", { dueAt: Date.now() + 60_000 });
```

Closing the inbox stops the timers and waits for runs in flight.
Pending input stays in the store.
Close the store yourself afterwards.

```ts
await inbox.close();
await store.close();
```

Opening a SQLite file whose stored input is not valid JSON fails with
`InboxItemUnreadableError`, which names the item id.
