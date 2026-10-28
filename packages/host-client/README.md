# @mg/host-client

The client side of the HTTP interface of `@mg/host`. A client for one
service, such as Discord, writes only the translation between its
service and the host.

It depends on nothing but `fetch`, which you may pass in. It holds the
host's token and nothing else: it does not store cursors.

## Features

- `send` puts input into a conversation. When the host refuses, it
  throws `HostRequestError` with the status and the host's `error` text.
- `replies` yields the records of the conversations you name, exactly
  by id, by prefix, or both. With neither, it yields every record.
- Reconnects when the stream ends or fails, from the cursor of the last
  record whose step in your loop completed.
  The wait starts at 500 ms, doubles to at most 30 s, and starts over
  after a record arrives.
- Throws `HostRequestError` on `401` and `400`, without retrying.
- Ends without an error when the signal you pass aborts.

## Usage

Keep the cursor of each record after you handle it. Start from it the
next time the client starts.

```ts
import { createHostClient } from "@mg/host-client";

const host = createHostClient({
  url: "http://127.0.0.1:8787",
  token: process.env.HOST_TOKEN!,
});

await host.send("discord:1234", "good morning");

for await (const record of host.replies({
  after: await loadCursor(),
  prefix: "discord:",
})) {
  await handle(record);
  await saveCursor(record.cursor);
}
```
