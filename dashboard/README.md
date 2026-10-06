# @mg/dashboard

A package on the using side that holds the screens for using harnesses day to day.

## Features

- A local server that draws the dashboard's pages and prints one launch link.
- It listens on 127.0.0.1 only, on a free port picked at start.
- Opening the launch link starts a session. Nothing else on the network, and no other web page in the browser, can reach the server.
- A page frame with navigation to three places: the home page, Harnesses, and API keys.
- On the Harnesses page a harness is created, edited, and deleted through a form: name, provider, model, turn limit, working folder, tools, path rules, and an optional LLM judge. A form that cannot make a valid harness is not saved and names the wrong field.
- Each harness is kept as one JSON file under `harnesses/` in the data folder, named by an id that does not change on rename. A file that does not parse is listed by name and is not opened.
- API keys show an empty state until the page behind it is built.
- Generic parts (`ui`), parts that know the dashboard (`feature`), pages, and the token file, with a Storybook for them.

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

| Option       | Meaning                                                                    |
| ------------ | -------------------------------------------------------------------------- |
| `--data-dir` | Where data is kept. Default: `~/Library/Application Support/mg-dashboard/` |
| `--port`     | A fixed port. Default: a free port picked at start                         |

A taken port, or a data folder that cannot be created, ends the process with a non-zero code. The reason goes to stderr and no launch link is printed.

To look at the parts alone, run `pnpm --filter @mg/dashboard storybook`.

## API

`dashboard/src/server.entry.json` declares how to run the server.

### `createApp(parts)`

Builds the Hono app from `{ session, dataDir, definitions }`. `definitions` is a `DefinitionStore`.

### `DefinitionStore`

`list`, `get`, `put`, and `delete` over harness definitions. `put` throws `NameTakenError` when another id holds the name. `createFileDefinitionStore({ dir })` is the one implementation.

### `parseDefinition(value)`

Checks a value as a harness definition and returns it, or the problems with the path of each wrong field. A definition with tools needs a working folder, and a path rule or a judge.

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
