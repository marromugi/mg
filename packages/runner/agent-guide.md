# @mg/runner — agent guide

Write a config in `runs/`, run it with `run` / `runMany`, read the trace it wrote.
This file is the copy-pasteable reference for writing that config.

## 1. Complete example

Example config (see `runs/loop-bash.config.ts` for the file in the repo):

```ts
import { defineRun } from "@mg/runner";
import { createOpenRouterProvider } from "@mg/core";
import { createBashTool } from "@mg/tools";

const apiKey = process.env.OPENROUTER_API_KEY;
if (apiKey === undefined)
  throw new Error("OPENROUTER_API_KEY is not set");

export default defineRun({
  name: "loop-bash",
  provider: createOpenRouterProvider({ apiKey }),
  harness: { kind: "loop", model: "openai/gpt-4o-mini", maxTurns: 10 },
  tools: [createBashTool({ cwd: process.cwd() })],
  trace: { jsonlPath: "./trace.jsonl" },
});
```

## 2. Field reference

### `RunConfig` (`packages/runner/src/config.ts`)

| Field      | Type                                 | Required | Meaning                                                                                                              |
| ---------- | ------------------------------------ | -------- | -------------------------------------------------------------------------------------------------------------------- |
| `name`     | `string`                             | yes      | Run name. Written as the `mg.run.name` trace attribute. Change it whenever the config's contents change (see Rules). |
| `provider` | `Provider` (from `@mg/core`)         | yes      | LLM connection the harness calls.                                                                                    |
| `harness`  | `HarnessConfig`                      | yes      | Harness settings, picked by `kind`. See the per-kind table below.                                                    |
| `tools`    | `readonly Tool[]`                    | no       | Tools the harness may call.                                                                                          |
| `trace`    | `Omit<TraceSdkOptions, "sessionId">` | no       | Where trace spans get written. See the trace table below; full semantics in `packages/trace/README.md`.              |

### `HarnessConfig`: kind `"loop"` (`LoopHarnessConfig`)

`HarnessConfig` is currently just `LoopHarnessConfig`. If a new harness kind exists and isn't
listed here, check `packages/runner/src/config.ts` and the matching harness package's README.

| Field      | Type      | Required            | Meaning                                           |
| ---------- | --------- | ------------------- | ------------------------------------------------- |
| `kind`     | `"loop"`  | yes                 | Selects the loop harness (`@mg/harness-loop`).    |
| `model`    | `string`  | yes                 | Model name passed to `provider`.                  |
| `maxTurns` | `number`  | yes                 | Max tool-call turns before the harness stops.     |
| `stream`   | `boolean` | no (default `true`) | Whether the provider is called in streaming mode. |

### `trace` (`TraceSdkOptions`, minus `sessionId`)

`sessionId` is not settable here — the runner supplies it (`RunOptions.sessionId`, or a
generated id if you don't pass one) and merges it in itself.

| Field         | Type             | Required            | Meaning                                                                                                                  |
| ------------- | ---------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `jsonlPath`   | `string`         | no                  | Append spans as JSON Lines to this file.                                                                                 |
| `sqlitePath`  | `string`         | no                  | Write spans to a SQLite database at this path. Cannot be `":memory:"`.                                                   |
| `exporters`   | `SpanExporter[]` | no                  | Extra OpenTelemetry exporters (e.g. OTLP). The runner does not close these — whoever constructed them owns closing them. |
| `serviceName` | `string`         | no (default `"mg"`) | Resource `service.name` attribute.                                                                                       |

Field meanings, how they combine, and how to read the output back are in
`packages/trace/README.md` — this table only tracks the shape.

## 3. Building blocks

| Kind     | Factory                             | Import from |
| -------- | ----------------------------------- | ----------- |
| Provider | `createOpenRouterProvider(options)` | `@mg/core`  |
| Tool     | `createBashTool(options)`           | `@mg/tools` |

```ts
import { createOpenRouterProvider } from "@mg/core";
import { createBashTool } from "@mg/tools";

const apiKey = process.env.OPENROUTER_API_KEY;
if (apiKey === undefined)
  throw new Error("OPENROUTER_API_KEY is not set");

const provider = createOpenRouterProvider({ apiKey });
const tool = createBashTool({ cwd: process.cwd() });
```

If a provider or tool you need isn't listed above, it may have been added since this was
written — check the README of `@mg/core` (providers, tools) and `@mg/tools`, and any other
`packages/*` that looks relevant, before assuming it doesn't exist.

## 4. Secrets

- Read secrets from `process.env` inside the config file, as in the example above.
- Never write an API key or other secret literally into a config file.
- `.env` (and `.env.*`) is git-ignored at the repo root — put secrets there.
- Load it when running a config:

```
node --env-file=.env ./runs/example.ts
```

## 5. Running

Workspace packages (`@mg/runner`, `@mg/core`, `@mg/tools`, …) resolve from their built
`dist/`, so build once before running anything:

```
pnpm build
```

One case, with `run`:

```ts
import type { Message } from "@mg/core";
import { run } from "@mg/runner";
import config from "./loop-bash.config.ts";

const messages: Message[] = [
  { role: "user", content: "ls の結果を教えて" },
];
const { sessionId, result } = await run(config, messages);
console.log(sessionId, result);
```

Several cases, with `runMany` and a `RunCase[]`:

```ts
import type { RunCase } from "@mg/runner";
import { runMany } from "@mg/runner";
import config from "./loop-bash.config.ts";

const cases: RunCase[] = [
  { id: "case-1", messages: [{ role: "user", content: "1 + 1 は？" }] },
  { id: "case-2", messages: [{ role: "user", content: "2 + 2 は？" }] },
];

const outcomes = await runMany(config, cases, { concurrency: 2 });
for (const outcome of outcomes) {
  if ("error" in outcome) console.error(outcome.id, outcome.error);
  else console.log(outcome.id, outcome.sessionId);
}
```

Picking a config by path instead of a static import, with `loadRun`:

```ts
import { loadRun, run } from "@mg/runner";

const config = await loadRun("./loop-bash.config.ts");
const { sessionId } = await run(config, [
  { role: "user", content: "hello" },
]);
console.log(sessionId);
```

## 6. Where results go

- `run` returns `{ sessionId, result }`; `runMany` returns one outcome per case, each carrying
  its own `sessionId` and either `result` or `error`.
- Trace spans go wherever `trace` in the config points: the JSONL file, the SQLite database,
  and/or any extra `exporters` — see `packages/trace/README.md` for how to read them back.
- Every span for one `run` call carries `mg.run.name` (the config's `name`). Spans from a
  `runMany` case also carry `mg.run.case` (that case's `id`). Filter on these to find a run.

## 7. Rules

- One config per experiment. Don't reuse a single `runs/*.config.ts` for unrelated setups —
  add a new file instead.
- Change `name` whenever a config's contents change (model, tools, harness settings, trace
  target, …). `mg.run.name` is only useful for filtering if it stays tied to one setup.
- Don't put prompts in the config. Pass them as `messages` to `run` / `runMany` at call time.
