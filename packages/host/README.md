# @mg/host

A package that serves one agent to remote clients over HTTP.
A client holds only a token. It sends text to a conversation, now or for
a set time, and reads the agent's replies.

The host never reads a key. The agent's run config, the stores, the
reply log, the client tokens and the clock are given to `createHost`.
How the server is started (address, port, data folder, provider) belongs
to the entry. See `runs/host-server.ts`.

## Features

- Admits a client by `Authorization: Bearer <token>`.
  Tokens are compared by SHA-256 with a timing-safe compare.
  A missing or wrong token gets `401 {"error":"unauthorized"}` before
  anything else runs.
  Every client sees every conversation.
- Hands each input to `@mg/inbox`, which holds it until it is due.
  Each input runs once on the agent through `continueConversation`,
  with the whole saved history.
  A conversation is created in the conversation store on its first input.
- Keeps replies in a `ReplyLog`, which a client reads from a cursor.
  A reply written while the client was away, or across a restart, is
  there when it reads again.
  Cursors are whole numbers that increase, starting at 1.
- Writes a `failed` reply with the reason when the run throws or the
  turn is not saved. The input is not run again.
- Has 2 implementations of `ReplyLog`.
  One lives only inside the process, the other uses SQLite.

## Endpoints

Send input. Answers `202` with the id of the input and its due time.
`dueAt` is milliseconds since the epoch and defaults to now.
Bad JSON, a missing `text` or a `dueAt` that is not a finite number
gets `400 {"error": "..."}`, and nothing enters the inbox.

```
POST /conversations/:id/inputs
{ "text": "good morning", "dueAt": 1767225600000 }
```

Read replies after a cursor. The response is NDJSON and stays open,
streaming new replies as they are written, until the client closes it.

```
GET /replies?after=0
{"cursor":1,"conversationId":"jev","inputId":"...","kind":"reply","text":"..."}
{"cursor":2,"conversationId":"jev","inputId":"...","kind":"failed","reason":"..."}
```

## Usage

```ts
import { createHost } from "@mg/host";
import { openSqliteReplyLog } from "@mg/host/sqlite";

const host = createHost({
  agent,
  conversations,
  inbox,
  replies: await openSqliteReplyLog("./replies.db"),
  clients: [{ name: "phone", token }],
});
await host.start();
// serve host.app.fetch with any HTTP server
await host.close();
```

Closing the host ends open reply streams and waits for runs in flight.
It does not close the stores or the reply log. Close them yourself.

Delivery is at least once. If the process stops after a reply is written
and before the input is marked done, the input runs again and the client
sees a second reply for it.
