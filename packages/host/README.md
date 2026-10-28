# @mg/host

A package that serves one agent to remote clients over HTTP.
A client holds only a token. It sends text to a conversation, now or for
a set time, and reads the agent's replies.

The host never reads a key. The stores, the reply log, the client
tokens and the clock are given to `createHost`, with a function that
builds the agent's run config from the tools and gate the host
provides. `instruction` may tell the agent the time at each turn.
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
- Gives the agent one tool, `later`, built for each run and bound to
  the conversation being run.
  The agent sets `inSeconds` (a whole number from 1 to 604800) and a
  `note`. The note enters the inbox for that conversation, and the
  tool returns `{ "dueAt": <ms since epoch> }`.
  Out of range or not a whole number: the tool returns an error
  naming the range, and nothing is scheduled.
  The host writes a `scheduled` reply with `dueAt` and `note`, so the
  client sees when the agent will get back.
  If the input runs again after a stop, its nth `later` call gets the
  time the first run set for that call, and nothing more is added.
  When the note is due it runs as an input of the same conversation.
  The agent reads it as `[note to self, set at <ISO time>]` followed
  by the note, and the reply goes to the log as usual, also after a
  restart.
- Runs the agent behind a gate that allows `later` and refuses every
  other call with "only the later tool is allowed on the host".
  `onRefusal` is told of each refusal.
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
{"cursor":3,"conversationId":"jev","inputId":"...","kind":"scheduled","callIndex":1,"dueAt":1767225600000,"note":"..."}
```

## Usage

```ts
import { createHost } from "@mg/host";
import { openSqliteReplyLog } from "@mg/host/sqlite";

const host = createHost({
  agent: ({ tools, gate }) => defineRun({ ...config, tools, gate }),
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

Before an input runs, the reply log notes how many entries the
conversation holds. If the process stops and the input runs again, the
host answers from the turn the first run saved, or does nothing when the
reply was already written. The model is not called a second time.
Delivery is still at least once for the window between the model's
answer and the save of the turn: there the input runs again.
