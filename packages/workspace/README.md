# @mg/workspace

A base package for working on a machine other than your own.

What a workspace bundles is ways to connect to another machine.
In code, one of these is called a connector.
A set of connectors is called a workspace.

## Features

- Defines the workspace type.
  A workspace is a name and a list of connectors.
- Defines the connector type.
  A connector holds only an open operation.
- Holds `openWorkspace`, a function that opens a workspace.
  It opens every connection and gathers the tools into one list.
- Holds dedicated exceptions for open failures and close failures.
- Holds a function that returns the names of what is held exclusively.
  The function is named `exclusiveNamesOf`.

## Usage

A workspace is made with `defineWorkspace`.
You pass it a name and a list of connectors.

```ts
import { defineWorkspace, openWorkspace } from "@mg/workspace";

const workspace = defineWorkspace({
  name: "build-machine",
  connectors: [sshConnector, cdpConnector],
});

const opened = await openWorkspace(workspace);

// Pass opened.tools to the harness

await opened.close();
```

## API

The prerequisites for each connector are written in its section below.
Prerequisites are what the machine side needs.
The person who owns the machine sets them up.

### `openWorkspace(workspace)`

`openWorkspace` opens the connectors in list order.
It does not open them at the same time.

If even one fails along the way, it closes the ones already opened.
After that, it throws.
The same happens when tool names overlap across connectors.

An abort signal (AbortSignal) passes through as is, without wrapping.
If the signal is already aborted, it throws without opening any.

The returned `close` closes the opened connections in reverse order.
If one fails, it keeps closing the rest.
Calling it a second time or later does nothing.

### Errors

This table lists the exceptions it throws.

| Exception                | Thrown when                                |
| ------------------------ | ------------------------------------------ |
| `ConnectorOpenError`     | A connector could not be opened            |
| `DuplicateToolNameError` | Tool names overlapped                      |
| `WorkspaceCloseError`    | A connection failed while closing          |
| `ConnectorCloseError`    | Both of a connector's 2 close steps failed |

`ConnectorOpenError` has `kind` and `index`.
The original exception is in `cause`.

`DuplicateToolNameError` has `toolName`.
The list of `kind` values of the overlapping connectors is in `kinds`.

`WorkspaceCloseError` has `errors`, the list of exceptions that failed.
The first one is also in `cause`.

`ConnectorCloseError` has `kind` and `errors`, the list of exceptions that failed.
The first one is also in `cause`.

`isWorkspaceError` tells whether a value is one of these exceptions.

### SSH

A connector that connects to a machine over SSH.
It uses only widely agreed standards, so no custom program is placed on the machine side.

The list of names it holds exclusively is empty.
However many you connect, they do not interfere with each other.

When opened, it returns one tool.
The tool is named `shell`.
It runs one given command in the remote shell.

The result string has the same form as the bash tool.
Standard output comes first, followed only by the markers needed.

| Marker                   | Added when                     |
| ------------------------ | ------------------------------ |
| `[stderr]`               | There is standard error output |
| `[exit code: N]`         | The exit code is not 0         |
| `[killed by SIGNAL]`     | It was stopped by a signal     |
| `[timed out after N ms]` | It timed out                   |
| `[output truncated]`     | The output went over the limit |

Timeouts and output over the limit are not exceptions.
Both are written as markers in the result string.

When the command itself cannot run, such as when the connection is lost, it throws.
The harness side returns that to the LLM as a result.

#### Prerequisites on the machine side

- An SSH server must be listening on the given host name and port.
- You must be able to log in with a private key or a password.
- The route to the machine is set up by the person who owns it.
  What this base holds is only the code that passes through the SSH connection.
  It holds no code that opens a route to the machine.

#### Options when creating it

```ts
import { createSshConnector } from "@mg/workspace";

const sshConnector = createSshConnector({
  host: "build.example.com",
  username: "deploy",
  auth: { privateKey: fs.readFileSync("id_ed25519", "utf8") },
});
```

This table lists what you can set.

| Option           | Meaning                                                      | Default     |
| ---------------- | ------------------------------------------------------------ | ----------- |
| `host`           | Host name of the machine                                     | Required    |
| `port`           | Port of the SSH server                                       | `22`        |
| `username`       | User name to log in as                                       | Required    |
| `auth`           | Private key or password                                      | Required    |
| `cwd`            | Working directory to run commands in                         | User's home |
| `timeoutMs`      | Time limit for one command (milliseconds)                    | `30000`     |
| `maxOutputBytes` | Limit for each of standard output and standard error (bytes) | `1048576`   |

`auth` is either a private key or a password, not both.

```ts
{ privateKey: string, passphrase?: string }
{ password: string }
```

#### About tests

`client.ts` needs a real SSH server.
So it has no unit tests.

Building the tool (`tool.ts`) is tested with a mock `SshClient`.

### SSH endpoint

An endpoint that connects from your side to a port inside the machine, through the SSH connection.
Its type is `Endpoint`, and it can be passed to the CDP connector.

When opened, it does the following.

- Opens its own SSH connection.
- Tries once to connect, through SSH, to the host and port as seen from the machine.
- If refused, it fails with `NothingListeningError`.
  It counts as refused when the SSH error's `reason` is 2 and its message contains `Connection refused`.
  The message is `nothing is listening on <host>:<port> on <SSH host>`.
  The SSH connection is closed.
- If it connects, it listens on a free local port on 127.0.0.1.
  It returns that host and port.

Connections received on that listener are passed through SSH.
Then they are connected to the machine's host and port.
Only connections that could not be connected are dropped.
The endpoint stays open and accepts the next connection.

When it cannot reach for any reason other than refusal, it throws the SSH error as is.
For example, when the SSH server does not allow forwarding.

When closed, it closes the listener, the received connections, and the SSH connection.
Closing it a second time or later does nothing.

```ts
import fs from "node:fs";
import { createCdpConnector, createSshEndpoint } from "@mg/workspace";

const cdpConnector = createCdpConnector({
  browser: "pi-01.local:9333",
  endpoint: createSshEndpoint({
    host: "pi-01.local",
    username: "marromugi",
    auth: { privateKey: fs.readFileSync("id_ed25519", "utf8") },
    remotePort: 9333,
  }),
});
```

This table lists what you can set.

| Option       | Meaning                                      | Default     |
| ------------ | -------------------------------------------- | ----------- |
| `host`       | Host name of the SSH server                  | Required    |
| `port`       | Port of the SSH server                       | `22`        |
| `username`   | User name to log in as                       | Required    |
| `auth`       | Private key or password                      | Required    |
| `remoteHost` | Host to connect to, as seen from the machine | `127.0.0.1` |
| `remotePort` | Port to connect to, as seen from the machine | Required    |

The browser is started ahead of time by the environment on the machine side.
This endpoint only connects.
It neither starts nor cleans up the browser.

#### About tests

`toSshForwarder` in `client.ts` is tested with a fake ssh2 connection.
The endpoint itself (`endpoint.ts`) is tested with a fake of the interface that opens forwarding.

### CDP

A connector that connects to a browser on another machine over CDP.
CDP is an agreed protocol for controlling Chrome from outside.

It connects to a browser that is already running.
It creates no new context and uses the context the browser already has.
The login state stays in that browser.

It is given the name of the browser it drives, in `browser`.
The name is the config author's statement of which browser this connector drives.
It holds exactly that name exclusively, whether it is given a URL or an endpoint.
Two connectors reach the same browser only when they are given the same name.
Nothing normalizes, resolves, or compares addresses, so the name is used as written and compared exactly.
A name with no non-space character gives `TypeError` at creation time.
Passing a string that cannot be read as a URL also gives `TypeError` at creation time.
The URL is checked before the name.

Instead of a URL, you can pass an endpoint (`Endpoint`).
When opened, an endpoint returns a host and port usable from your side, and when closed, it cleans up.

When an endpoint is passed, opening opens the endpoint, builds the URL `http://<host>:<port>` from the returned host and port, and connects.
If it cannot connect to the browser, it closes the endpoint, then fails with the connection exception.
When closing, it disconnects from the browser, then closes the endpoint.
If one fails, the other is still closed.
If both fail, it fails with `ConnectorCloseError`.

When opened, it returns 4 tools.

| Tool name          | What it does                                            |
| ------------------ | ------------------------------------------------------- |
| `browser_navigate` | Moves the page to the given URL.                        |
| `browser_read`     | Returns the page contents as a tree of roles and names. |
| `browser_click`    | Clicks the element given by role and name.              |
| `browser_type`     | Types text into the element given by role and name.     |

What `browser_read` returns is not a picture of the screen.
It is text: the page's elements as a tree of roles (role) and names (name).

`browser_click` and `browser_type` point at an element by role and name.
When the element is not found, or there are several, it throws.
The harness side returns that to the LLM as a result.

Passing `submit` to `browser_type` presses Enter after typing the text.

#### Prerequisites on the machine side

- Chrome or Chromium must be running.
  Start it with `--remote-debugging-port`.
- That port must be visible from the side that runs.
- The login state stays in that browser's profile.
  Closing does not erase it.
- The browser is started ahead of time by the environment on the machine side.
  This base neither starts nor cleans up the browser.
- This applies when going through the SSH endpoint.
  The browser may listen only on the machine's 127.0.0.1.
- The route to the machine is set up by the person who owns it.
  What this base holds is only the code that passes through the SSH connection.
  It holds no code that opens a route to the machine.

#### Options when creating it

```ts
import { createCdpConnector } from "@mg/workspace";

const cdpConnector = createCdpConnector({
  browser: "localhost:9222",
  url: "http://localhost:9222",
});
```

This table lists what you can set.

| Option           | Meaning                                                        | Default                   |
| ---------------- | -------------------------------------------------------------- | ------------------------- |
| `browser`        | Name of the browser this connector drives                      | Required                  |
| `url`            | URL of the browser's CDP endpoint                              | Either this or `endpoint` |
| `endpoint`       | Endpoint that returns a host and port reachable from your side | Either this or `url`      |
| `timeoutMs`      | Time limit for one operation (milliseconds)                    | `30000`                   |
| `maxOutputBytes` | Output limit for `browser_read` (bytes)                        | `1048576`                 |

#### About tests

`browser.ts` needs a real browser.
So it has no unit tests.

Building the tools (`tools.ts`) is tested with a mock `BrowserPage`.

## How it works

### How the types are split

A connector holds only an open operation.

An open connection holds only a list of tools and a close operation.
The list of possible operations is not held in a separate type.
The set of tools it returns is itself the list of possible operations.

Concrete ways such as SSH and CDP are implementations of this type.
The type side has no branching per way.

### What a connector holds exclusively

A connector declares the names of what it holds exclusively.

Connectors that break when the same target is opened twice at once use this declaration.
For example, CDP grabs the first tab of the same browser.
So it cannot be opened at the same time as a connector pointing at the same target.

An empty list of names means it holds nothing exclusively.
How names are made is decided by each connector implementation.

Pass a workspace to `exclusiveNamesOf`.
It returns the list of names gathered from every connector's declaration.
Duplicates are removed, and the names are sorted in ascending string order.

## Non-goals

- It does not yet hold the wiring into runner.
- It does not hold tracing.
  Tracing is added on the runner side.
- It does not hold tool implementations.
  Tools are returned by the connector implementations.
