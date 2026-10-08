# @mg/dashboard

A package on the using side that holds the screens for using harnesses day to day.

## Features

- A local server that draws the dashboard's pages and prints one launch link.
- It listens on 127.0.0.1 only, on a free port picked at start.
- Opening the launch link starts a session. Nothing else on the network, and no other web page in the browser, can reach the server.
- A page frame with navigation to the home page and Agents. Each page is drawn on the server and taken over in the browser by one script, `dist/browser.js`.
- On the Agents page an agent is created through steps, and its page opens once it is saved: name, provider, model, turn limit, system prompt, working folder, tools, path rules, and an optional LLM judge. Steps that cannot make a valid agent are not saved and name the wrong field.
- Each harness is kept as one JSON file under `harnesses/` in the data folder, named by an id that does not change on rename. A file that does not parse is listed by name and is not opened.
- The OpenRouter key is read from the macOS Keychain. No page sets it yet.
- An agent's page shows what the agent is and has a panel to try it in. A message sent there starts a conversation, and later messages continue it. Assistant text, each tool call with its input, and each tool result arrive as they happen. Assistant text is drawn as Markdown, and none of its syntax shows while it arrives. A tool call is a card that opens to what the tool was given and what it gave back, shown as highlighted code in the language its input names; a call a guard refused is marked. The stop button cuts the answer short. A failed answer shows the error's message.
- The system prompt is edited on the agent's page and saved with the button under it. The panel answers from the prompt as it is on the page, saved or not; a message sent after the prompt changed starts a new conversation.
- Each answer writes one JSONL trace file under `traces/` in the data folder.
- Conversations are kept in memory while the server lives. After a restart a message into an old conversation fails and says to start a new one.
- Without the OpenRouter key an agent on OpenRouter does not answer, and the panel names `OPENROUTER_API_KEY`.
- Generic parts (`ui`), parts that know the dashboard (`feature`), pages, and the token file, with a Storybook for them.
- Each agent has a face, drawn from a seed kept with it. The faces come from [Humation](https://github.com/humation-labs/humation), whose code and drawings are MIT licensed.

## Usage

Build once, then start the server.

```
pnpm build
node dashboard/dist/server.js --data-dir <dir> --port <n>
```

The first line it prints is the launch link.

```
http://127.0.0.1:<port>/enter?token=<token>
```

Open it in a browser. It sets a session cookie and moves to the home page.

| Option                     | Meaning                                                                    |
| -------------------------- | -------------------------------------------------------------------------- |
| `--data-dir`               | Where data is kept. Default: `~/Library/Application Support/mg-dashboard/` |
| `--port`                   | A fixed port. Default: a free port picked at start                         |
| `--keychain-service`       | The Keychain service that keys are kept under. Default: `mg-dashboard`     |
| `--exit-when-stdin-closes` | Ends the server when its standard input reaches end of file. Default: off  |

A harness's gate is judged by Jev. The server reads the Typesafe AI key for it from its own environment, and no page shows or changes it. Without the key a harness with a gate is saved but does not run.

```
TYPESAFE_API_KEY=<key> node dashboard/dist/server.js
```

A taken port, or a data folder that cannot be created, ends the process with a non-zero code. The reason goes to stderr and no launch link is printed.

### Desktop app

`mg dashboard.app` starts the server, opens a window on its launch link, and stops the server when it quits. It is built on a Mac with its own command. The repo-wide `pnpm build` and CI do not build it, because they run without Rust.

```
node dashboard/app/build.mjs
open "dashboard/app/src-tauri/target/release/bundle/macos/mg dashboard.app"
```

The build needs `cargo` and `rustc`. It builds the dashboard, bundles the server and its workspace packages into one file, copies the built stylesheet and the Node that runs the build into the app, and runs `tauri build`. The app is not signed or notarized, and it is for the Mac that built it.

- The app runs the server with `--exit-when-stdin-closes` and holds the other end of its standard input open, so the server also ends when the app is killed or crashes.
- Otherwise it uses the options' defaults, so data is kept in `~/Library/Application Support/mg-dashboard/`.
- One window. Closing it, or quitting the app, stops the server. Opening the app again focuses the open window.
- If the server prints no launch link within 10 seconds, or exits first, the window shows what the server wrote to stderr and a Quit button.
- The window may show the server's own address only. The page gets no Tauri API and no command.
- The browser and ssh connectors and the SQLite stores are not in the bundle. The dashboard builds local tools and writes JSONL traces, so it never reaches them.

To look at the parts alone, run `pnpm --filter @mg/dashboard storybook`.

The pages call the JSON API under `/api`. Its routes in `src/api` describe themselves with zod, and the hooks and msw handlers in `src/api-client/generated` are generated from them. After changing a route, generate them again:

```sh
pnpm --filter @mg/dashboard generate:api
```

Stories that call the API answer it with those handlers. To run every story in a browser, with the steps a story declares:

```sh
pnpm --filter @mg/dashboard exec playwright install chromium
pnpm --filter @mg/dashboard test:stories
```

## API

`dashboard/src/server.entry.json` declares how to run the server.

### `createApp(parts)`

Builds the Hono app from `{ session, dataDir, definitions, secrets, runs }`. `definitions` is a `DefinitionStore`, `secrets` is a `SecretStore`, and `runs` is a `TestRuns`.

### `DefinitionStore`

`list`, `get`, `put`, and `delete` over harness definitions. `put` throws `NameTakenError` when another id holds the name. `createFileDefinitionStore({ dir })` is the one implementation.

### `SecretStore`

`has`, `get`, `set`, and `delete` over a secret kept under a `SecretName` (now `OPENROUTER_API_KEY`). `get` is for the server's own code; no page or log receives a value. `createKeychainSecretStore({ service, spawn? })` is the one implementation: a generic password with that service and the name as account, run through `/usr/bin/security`. A value goes to `security -i` on stdin as hex, so it is never in the process's argument list. `security -i` reads a command line in pieces of 4095 characters, so a value whose command does not fit in one piece is refused before anything runs (`SecretTooLongError`, 2,010 bytes with the service `mg-dashboard`) and the page shows a field message. A `security` failure other than "not found" throws a `SecretStoreError` with the exit code and stderr, with every part of the value and of its hex removed.

### `TestRuns`

`start(definition, input)` turns a saved definition into a run config with `assemble` and runs it in the background. It returns `{ ok: true, runId }`, or `{ ok: false, missingSecret }` when the OpenRouter key is not set. A definition that cannot be turned into a config (for example a judge on a provider that cannot force a tool call) starts a run that ends as `failed` with the reason. `watch(runId)` gives every `TestRunEvent` of the run from its first, then the ones still to come; it is undefined for an unknown run. `stop(runId)` aborts a running run and returns true, or returns false for an unknown or ended run. `createTestRuns({ secrets, dataDir, run? })` is the one implementation; `run` defaults to the run package's `run`, and tests hand it a fake. Traces go to `<dataDir>/traces/<runId>.jsonl`.

### `parseDefinition(value)`

From `src/definition-parser`. Checks a value as a harness definition and returns it, or the problems with the path of each wrong field. A definition with tools needs a working folder, and a path rule or a judge.

### `createSession(options)`

Takes `{ token, address }` and returns `{ middleware }`. The middleware refuses a request in this order.

| Request                                                        | Answer |
| -------------------------------------------------------------- | ------ |
| `Host` is not `address`                                        | 403    |
| Not GET, HEAD or OPTIONS, and `Origin` is not the server's own | 403    |
| `/enter` with a wrong token, or a token already used           | 401    |
| Any other path without the session cookie                      | 401    |

## How it works

- The token is made at start and works once. `/enter?token=<token>` sets the session cookie `mg_dashboard_session_<port>` (HttpOnly, SameSite=Strict, Path=/) and redirects to `/`.
- Refusals are thrown by the session and turned into pages by the app.
- Pages are rendered on the server with React and have no client bundle. They work through links and forms.
- `pnpm build` runs `tsc`, then the Tailwind CLI, which writes `dist/styles.css` from `src/styles/tokens.css`. The server serves it at `/styles.css`.
- Every class is checked against the token file by the lint.

## Non-goals

- It holds no harness parts. Its definition type is plain data.
- It does not store traces. Storage stays trace's job.
- It has no public exports. Nothing imports it.
- It has no login. The launch link is the only way in.
