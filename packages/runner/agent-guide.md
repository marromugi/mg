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

Adding a gate that checks each tool call before it runs (see
`runs/loop-bash-gate.config.ts` for the file in the repo):

```ts
import { defineRun } from "@mg/runner";
import { createOpenRouterProvider } from "@mg/core";
import { createBashTool } from "@mg/tools";
import { createLlmGate } from "@mg/gate";

const apiKey = process.env.OPENROUTER_API_KEY;
if (apiKey === undefined)
  throw new Error("OPENROUTER_API_KEY is not set");

const provider = createOpenRouterProvider({ apiKey });

export default defineRun({
  name: "loop-bash-gate",
  provider,
  harness: { kind: "loop", model: "openai/gpt-4o-mini", maxTurns: 10 },
  tools: [createBashTool({ cwd: process.cwd() })],
  gate: createLlmGate({
    provider,
    model: "openai/gpt-4o-mini",
    policy:
      "Read-only commands are allowed. Deleting files or " +
      "sending data outside the machine is not.",
  }),
  trace: { jsonlPath: "./trace.jsonl" },
});
```

Same gate, judged by an `Estimator` instead of the LLM provider (see
`runs/loop-bash-jev-gate.config.ts` for the file in the repo):

```ts
import { defineRun } from "@mg/runner";
import { createJevEstimator, createOpenRouterProvider } from "@mg/core";
import { createBashTool } from "@mg/tools";
import { createEstimatorGate } from "@mg/gate";

const apiKey = process.env.OPENROUTER_API_KEY;
if (apiKey === undefined)
  throw new Error("OPENROUTER_API_KEY is not set");

const jevApiKey = process.env.TYPESAFE_API_KEY;
if (jevApiKey === undefined)
  throw new Error("TYPESAFE_API_KEY is not set");

const provider = createOpenRouterProvider({ apiKey });

const policy =
  "Read-only commands are allowed. Deleting files or " +
  "sending data outside the machine is not.";

export default defineRun({
  name: "loop-bash-jev-gate",
  provider,
  harness: { kind: "loop", model: "openai/gpt-4o-mini", maxTurns: 10 },
  tools: [createBashTool({ cwd: process.cwd() })],
  gate: createEstimatorGate({
    estimator: createJevEstimator({ apiKey: jevApiKey }),
    policy,
  }),
  trace: { jsonlPath: "./trace.jsonl" },
});
```

Composing a rules gate with an LLM gate via `composeGates`, so path-based rules
are checked first and the LLM only judges what the rules don't cover (see
`runs/loop-files.config.ts` for a config that uses the rules gate on its own):

```ts
import { defineRun } from "@mg/runner";
import { createOpenRouterProvider } from "@mg/core";
import {
  createBashTool,
  createReadFileTool,
  createGrepTool,
  createWriteFileTool,
  createEditFileTool,
} from "@mg/tools";
import { composeGates, createLlmGate, createRulesGate } from "@mg/gate";

const apiKey = process.env.OPENROUTER_API_KEY;
if (apiKey === undefined)
  throw new Error("OPENROUTER_API_KEY is not set");

const provider = createOpenRouterProvider({ apiKey });
const root = process.cwd();

export default defineRun({
  name: "loop-files-composed-gate",
  provider,
  harness: { kind: "loop", model: "openai/gpt-4o-mini", maxTurns: 10 },
  tools: [
    createBashTool({ cwd: root }),
    createReadFileTool({ root }),
    createGrepTool({ root }),
    createWriteFileTool({ root }),
    createEditFileTool({ root }),
  ],
  gate: composeGates([
    createRulesGate({
      root,
      rules: [
        {
          tools: ["write_file", "edit_file"],
          paths: ["**/.env", "**/.env.*", "**/*.lock", ".git/**"],
          allowed: false,
          reason:
            "Secrets, lockfiles and .git are read-only for the agent.",
        },
      ],
    }),
    createLlmGate({
      provider,
      model: "openai/gpt-4o-mini",
      policy:
        "Read-only commands are allowed. Deleting files or " +
        "sending data outside the machine is not.",
    }),
  ]),
  trace: { jsonlPath: "./trace.jsonl" },
});
```

Adding a workspace, so the harness can also reach a remote machine over SSH and
its browser over CDP (see `runs/loop-workspace.config.ts` for the file in the
repo):

```ts
import { readFileSync } from "node:fs";
import { defineRun } from "@mg/runner";
import { createOpenRouterProvider } from "@mg/core";
import {
  createCdpConnector,
  createSshConnector,
  defineWorkspace,
} from "@mg/workspace";

const apiKey = process.env.OPENROUTER_API_KEY;
if (apiKey === undefined)
  throw new Error("OPENROUTER_API_KEY is not set");

const sshHost = process.env.MG_SSH_HOST;
if (sshHost === undefined) throw new Error("MG_SSH_HOST is not set");

const sshUser = process.env.MG_SSH_USER;
if (sshUser === undefined) throw new Error("MG_SSH_USER is not set");

const sshKeyPath = process.env.MG_SSH_KEY_PATH;
if (sshKeyPath === undefined)
  throw new Error("MG_SSH_KEY_PATH is not set");

const cdpUrl = process.env.MG_CDP_URL;
if (cdpUrl === undefined) throw new Error("MG_CDP_URL is not set");

export default defineRun({
  name: "loop-workspace",
  provider: createOpenRouterProvider({ apiKey }),
  harness: { kind: "loop", model: "openai/gpt-4o-mini", maxTurns: 10 },
  workspace: defineWorkspace({
    name: "build-machine",
    connectors: [
      createSshConnector({
        host: sshHost,
        username: sshUser,
        auth: { privateKey: readFileSync(sshKeyPath, "utf8") },
      }),
      createCdpConnector({ url: cdpUrl }),
    ],
  }),
  trace: { jsonlPath: "./trace.jsonl" },
});
```

Adding the search tool alongside bash (see `runs/loop-search.config.ts` for the file in
the repo):

```ts
import { defineRun } from "@mg/runner";
import { createOpenRouterProvider } from "@mg/core";
import {
  createBashTool,
  createWebSearchTool,
  createOllamaWebSearchBackend,
} from "@mg/tools";

const apiKey = process.env.OPENROUTER_API_KEY;
if (apiKey === undefined)
  throw new Error("OPENROUTER_API_KEY is not set");

const ollamaApiKey = process.env.OLLAMA_API_KEY;
if (ollamaApiKey === undefined)
  throw new Error("OLLAMA_API_KEY is not set");

export default defineRun({
  name: "loop-search",
  provider: createOpenRouterProvider({ apiKey }),
  harness: { kind: "loop", model: "openai/gpt-4o-mini", maxTurns: 10 },
  tools: [
    createBashTool({ cwd: process.cwd() }),
    createWebSearchTool({
      backend: createOllamaWebSearchBackend({ apiKey: ollamaApiKey }),
    }),
  ],
  trace: { jsonlPath: "./trace.jsonl" },
});
```

Adding a subagent the parent's LLM can call, letting it pick between the run's own
workspace and a separate one (see `runs/loop-subagent.config.ts` for the file in the
repo):

```ts
import { defineRun } from "@mg/runner";
import { createOpenRouterProvider } from "@mg/core";
import { createRulesGate } from "@mg/gate";
import {
  createCdpConnector,
  createSshConnector,
  defineWorkspace,
} from "@mg/workspace";

const apiKey = process.env.OPENROUTER_API_KEY;
if (apiKey === undefined)
  throw new Error("OPENROUTER_API_KEY is not set");

const provider = createOpenRouterProvider({ apiKey });

const buildMachine = defineWorkspace({
  name: "build-machine",
  connectors: [
    createSshConnector({
      host: "...",
      username: "...",
      auth: { privateKey: "..." },
    }),
    createCdpConnector({ url: "ws://localhost:9222" }),
  ],
});

const cleanBrowser = defineWorkspace({
  name: "clean-browser",
  connectors: [createCdpConnector({ url: "ws://localhost:9223" })],
});

export default defineRun({
  name: "loop-subagent",
  provider,
  harness: { kind: "loop", model: "openai/gpt-4o-mini", maxTurns: 10 },
  workspace: buildMachine,
  subagents: [
    {
      name: "researcher",
      description:
        "Researches a topic in a browser and reports what it finds.",
      provider,
      harness: {
        kind: "loop",
        model: "openai/gpt-4o-mini",
        maxTurns: 10,
      },
      gate: createRulesGate({ root: process.cwd(), rules: [] }),
      workspace: {
        pick: "caller",
        sources: [
          { kind: "parent" },
          { kind: "own", workspace: cleanBrowser },
        ],
        required: true,
      },
    },
  ],
  trace: { jsonlPath: "./trace.jsonl" },
});
```

## 2. Field reference

### `RunConfig` (`packages/runner/src/config.ts`)

| Field       | Type                                 | Required | Meaning                                                                                                                                                                                                   |
| ----------- | ------------------------------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`      | `string`                             | yes      | Run name. Written as the `mg.run.name` trace attribute. Change it whenever the config's contents change (see Rules).                                                                                      |
| `provider`  | `Provider` (from `@mg/core`)         | yes      | LLM connection the harness calls.                                                                                                                                                                         |
| `harness`   | `HarnessConfig`                      | yes      | Harness settings, picked by `kind`. See the per-kind table below.                                                                                                                                         |
| `tools`     | `readonly Tool[]`                    | no       | Tools the harness may call.                                                                                                                                                                               |
| `gate`      | `Gate` (from `@mg/gate`)             | no       | Judges each tool call before it runs. Build one with `@mg/gate` (e.g. `createLlmGate`, `createEstimatorGate`); the runner only passes it through.                                                         |
| `trace`     | `Omit<TraceSdkOptions, "sessionId">` | no       | Where trace spans get written. See the trace table below; full semantics in `packages/trace/README.md`.                                                                                                   |
| `workspace` | `Workspace` (from `@mg/workspace`)   | no       | A remote machine to open before the run and close after it. Its tools are appended after `tools`. Build one with `defineWorkspace`; see `packages/workspace/README.md`.                                   |
| `subagents` | `readonly SubagentConfig[]`          | no       | Subagents the parent's LLM can call, alongside `tools`. `run` builds each one after opening `workspace`, passing it the opened workspace and the run's exclusive-name state. Omitting it changes nothing. |

### `RunOptions` (`packages/runner/src/run.ts`)

The third argument to `run`. None of its fields are required.

| Field       | Type                            | Meaning                                                                                                                                                                                                                                                                                                                                                            |
| ----------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `signal`    | `AbortSignal`                   | Aborts the run; the harness rejects with the abort reason.                                                                                                                                                                                                                                                                                                         |
| `wrapUp`    | `AbortSignal`                   | Passed straight to the harness. When it fires, the harness stops early and returns with reason `"wrapped-up"` instead of throwing; see `packages/loop/README.md`.                                                                                                                                                                                                  |
| `tools`     | `readonly Tool[]`               | Tools for this call only. Appended after `RunConfig.tools` and the workspace's tools. A name shared with either throws `DuplicateToolNameError` (`packages/workspace/README.md`) before the provider is called, closing the workspace first; the added side's `kinds` entry is `"options"`. The config's `gate` judges calls to these tools the same as any other. |
| `sessionId` | `string`                        | The run's session id, used for its trace.                                                                                                                                                                                                                                                                                                                          |
| `caseId`    | `string`                        | Written as the `mg.run.case` trace attribute; set by `runMany`.                                                                                                                                                                                                                                                                                                    |
| `onEvent`   | `(event: HarnessEvent) => void` | Called for every harness event as it streams.                                                                                                                                                                                                                                                                                                                      |

`runMany` and `runOnTrigger` do not take `wrapUp` or `tools`; see their own option types.

### `ContinueOptions` (`packages/runner/src/continue-conversation.ts`)

The third argument to `continueConversation` and the fourth to `continueAsPersona`. It is
`RunOptions` plus one more field, so everything in the table above applies here too — `keep` is
stripped out before what's left is passed to `run`.

| Field  | Type                                                             | Meaning                                                                                      |
| ------ | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `keep` | `(added: readonly Message[]) => Message[] \| Promise<Message[]>` | Decides which of the run's added messages get appended. See "Deciding what gets kept" below. |

### `HarnessConfig`: kind `"loop"` (`LoopHarnessConfig`)

`HarnessConfig` is currently just `LoopHarnessConfig`. If a new harness kind exists and isn't
listed here, check `packages/runner/src/config.ts` and the matching harness package's README.

| Field      | Type      | Required            | Meaning                                           |
| ---------- | --------- | ------------------- | ------------------------------------------------- |
| `kind`     | `"loop"`  | yes                 | Selects the loop harness (`@mg/loop`).            |
| `model`    | `string`  | yes                 | Model name passed to `provider`.                  |
| `maxTurns` | `number`  | yes                 | Max tool-call turns before the harness stops.     |
| `stream`   | `boolean` | no (default `true`) | Whether the provider is called in streaming mode. |

### `SubagentConfig` (`packages/runner/src/subagent-config.ts`)

One entry in `subagents`. It never inherits `provider`, `gate` or `tools` from the run —
write everything the subagent needs into its own entry.

| Field         | Type                         | Required                           | Meaning                                                              |
| ------------- | ---------------------------- | ---------------------------------- | -------------------------------------------------------------------- |
| `name`        | `string`                     | yes                                | Name the parent's LLM calls it by.                                   |
| `description` | `string`                     | yes                                | Description the parent's LLM sees.                                   |
| `system`      | `string`                     | no                                 | Put at the start of the child's conversation, as a `system` message. |
| `provider`    | `Provider` (from `@mg/core`) | yes                                | LLM connection the child's harness calls.                            |
| `harness`     | `HarnessConfig`              | yes                                | The child's harness settings, same type as `RunConfig.harness`.      |
| `tools`       | `readonly Tool[]`            | no                                 | Tools the child may call.                                            |
| `gate`        | `Gate` (from `@mg/gate`)     | required if `tools` or `workspace` | Judges each call inside the child.                                   |
| `workspace`   | `SubagentWorkspace`          | no                                 | How the child receives a workspace. See the table below.             |

`SubagentWorkspace` picks between two shapes:

| `pick`     | Shape                                   | Meaning                                              |
| ---------- | --------------------------------------- | ---------------------------------------------------- |
| `"fixed"`  | `{ pick: "fixed", source }`             | Always uses the source written in the config.        |
| `"caller"` | `{ pick: "caller", sources, required }` | The parent's LLM picks a source, by name, each call. |

A `source` is one of:

| `kind`     | Shape                        | Meaning                                                              |
| ---------- | ---------------------------- | -------------------------------------------------------------------- |
| `"parent"` | `{ kind: "parent" }`         | Borrows the run's opened workspace. The child never closes it.       |
| `"own"`    | `{ kind: "own", workspace }` | Opens the given `Workspace` for the call and closes it when it ends. |

For `pick: "caller"`, the input schema gains a `workspace` argument enumerating the
sources by name (the parent's workspace's own name; an own source's `workspace.name`).
`required: false` lets the argument be omitted, running the child with no workspace.

A `"parent"` source with no `RunConfig.workspace` throws `InvalidRunConfigError` when
`run` assembles the subagent — before the provider is called even once. The same error
covers a name clash among `pick: "caller"` sources (including against the parent's own
workspace name), and an own workspace whose exclusive names overlap ones the run's own
workspace holds for the whole run (see `packages/workspace/README.md` on exclusive
names). A name shared between a tool and a subagent throws `DuplicateCallableNameError`
from `@mg/loop` at the same point.

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

| Kind     | Factory                                 | Import from |
| -------- | --------------------------------------- | ----------- |
| Provider | `createOpenRouterProvider(options)`     | `@mg/core`  |
| Provider | `createOllamaProvider(options)`         | `@mg/core`  |
| Tool     | `createBashTool(options)`               | `@mg/tools` |
| Tool     | `createReadFileTool(options)`           | `@mg/tools` |
| Tool     | `createGrepTool(options)`               | `@mg/tools` |
| Tool     | `createWriteFileTool(options)`          | `@mg/tools` |
| Tool     | `createEditFileTool(options)`           | `@mg/tools` |
| Tool     | `createWebSearchTool(options)`          | `@mg/tools` |
| Backend  | `createOllamaWebSearchBackend(options)` | `@mg/tools` |
| Gate     | `createLlmGate(options)`                | `@mg/gate`  |
| Gate     | `createRulesGate(options)`              | `@mg/gate`  |
| Gate     | `composeGates(gates)`                   | `@mg/gate`  |
| Check    | `rule(name, predicate)`                 | `@mg/eval`  |
| Check    | `createEstimatorChecker(options)`       | `@mg/eval`  |

```ts
import { createOpenRouterProvider } from "@mg/core";
import { createBashTool } from "@mg/tools";

const apiKey = process.env.OPENROUTER_API_KEY;
if (apiKey === undefined)
  throw new Error("OPENROUTER_API_KEY is not set");

const provider = createOpenRouterProvider({ apiKey });
const tool = createBashTool({ cwd: process.cwd() });
```

`createOllamaProvider` talks to a local (or self-hosted) ollama server
instead. It takes no API key; `baseUrl` defaults to `http://localhost:11434`:

```ts
import { createOllamaProvider } from "@mg/core";
import { createBashTool } from "@mg/tools";

const provider = createOllamaProvider({ think: false });
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

If the config has a `workspace`, or a subagent has an own workspace (`{ kind: "own" }` in a
`workspace` source), whether `concurrency` may be 2 or more depends on what their connectors
declare as held exclusively (see `packages/workspace/README.md`). If none of them hold
anything exclusively, cases run in parallel as usual. If any of them do, `concurrency` must
be 1 (or left unset); passing 2 or more throws a `RangeError` before any case runs, naming
the workspace and the exclusive names, e.g. `workspace "build-machine" holds
"cdp:localhost:9222" exclusively; concurrency must be 1, got 2`.

Picking a config by path instead of a static import, with `loadRun`:

```ts
import { loadRun, run } from "@mg/runner";

const config = await loadRun("./loop-bash.config.ts");
const { sessionId } = await run(config, [
  { role: "user", content: "hello" },
]);
console.log(sessionId);
```

Starting a run only when a trigger fires, with `runOnTrigger`:

```ts
import type { Message } from "@mg/core";
import { run, runOnTrigger } from "@mg/runner";
import type { Trigger } from "@mg/trigger";
import config from "./loop-bash.config.ts";

type TweetInput = { kind: "tweet"; text: string };

const trigger: Trigger<TweetInput> = {
  decide: async (input) => ({
    fired: input.text.length > 0,
    reason: "has text",
  }),
};

const outcome = await runOnTrigger(
  {
    trigger,
    toMessages: (input): Message[] => [
      { role: "user", content: input.text },
    ],
    start: (messages, options) => run(config, messages, options),
    trace: { jsonlPath: "./trigger.jsonl" },
  },
  { kind: "tweet", text: "hello" },
);

if (outcome.fired) console.log(outcome.run.sessionId);
else console.log(outcome.decision.reason);
```

`start` is required, with no default. It receives the converted messages and an options object
`{ sessionId, signal, onEvent }`, where `sessionId` is the run session id the entrance decided;
calling `run` from inside it, as above, is the usual way to wire it up. The type parameter that
`toMessages` returns and the one `start` accepts are tied together, so a `start` that can't
accept what `toMessages` converts to is a type error. `config.trace` (the entrance's own trace
option, not `RunConfig`'s) needs at least one destination (`jsonlPath`, `sqlitePath`, or a
non-empty `exporters` array) — checked at the type level. The input passed as the second
argument is limited to a `JsonValue` at the type level. The judgement record it writes is its
own session, distinct from the run's `sessionId` in the fired branch — see "Where results go"
below.

Continuing a saved conversation, with `continueConversation`:

```ts
import { createMemoryConversationStore } from "@mg/conversation";
import { continueConversation } from "@mg/runner";
import config from "./loop-bash.config.ts";

const store = createMemoryConversationStore();
await store.create("jev");

const outcome = await continueConversation(config, {
  store,
  id: "jev",
  history: { kind: "all" },
  messages: [
    { role: "system", content: "be brief" },
    { role: "user", content: "hello" },
  ],
});

if (outcome.saved)
  console.log(outcome.sessionId, outcome.result.reason);
else console.log(outcome.reason);
```

`conversation.history` has no default (`{ kind: "all" }` or `{ kind: "last", count }`), and
`conversation.messages` needs at least one entry — both are checked at the type level. A
`system` message can be one of `conversation.messages`; it reaches the model at the position
given and is written back to the entry at that same position. `options` is `ContinueOptions`
(`RunOptions` plus `keep`) and is passed through unchanged, so `sessionId`, `signal`,
`onEvent`, `wrapUp`, and `tools` all work the same way as with `run`. A run stopped by
`wrapUp` is appended the same as any other outcome. `continueAsPersona` forwards
`options` the same way, straight through to `continueConversation`.

### Deciding what gets kept

By default `continueConversation` appends everything the run added. Pass `options.keep` to
decide, after the run finishes and before the append, which of those added messages actually
land in the conversation — useful for dropping the tail of a reply the counterpart never
received, e.g. one cut off mid-sentence by an interruption.

```ts
import type { Message } from "@mg/core";
import { continueConversation, keepDelivered } from "@mg/runner";

const outcome = await continueConversation(
  config,
  {
    store,
    id: "jev",
    history: { kind: "all" },
    messages: [{ role: "user", content: "hi" }],
  },
  {
    keep: (added: readonly Message[]) =>
      keepDelivered(added, { kind: "until", turn: 0, end: 5 }),
  },
);
```

`keep` receives the run's added messages, in order, exactly once, and its answer is awaited
before anything is appended — even if the run itself already finished. The answer is accepted
only when it equals `added` itself, or equals `keepDelivered(added, { kind: "until", turn, end })`
for some assistant-message index `turn` and some text offset `end` within that turn's messages
(see `packages/runner/README.md` for the accepted/rejected figure). Any other answer, or a
`keep` that throws or rejects, means nothing is appended:

- A rejected answer gives `{ saved: false, reason: { kind: "not-in-result" } }`.
- A thrown or rejected `keep` gives `{ saved: false, reason: { kind: "keep-failed", error } }`,
  where `error` is exactly what was thrown.

`keepDelivered(added, position)` is the pure cutting helper `keep` is expected to build on. With
`{ kind: "all" }` it returns a shallow copy of `added`. With `{ kind: "until", turn, end }`,
assistant messages before `turn` are kept whole, that turn's text parts are sliced to total
`end` JS-string units (dropping any part left empty), everything after `turn` keeps only its
tool-call and reasoning parts, and tool/system/user messages are always kept whole. An
assistant message left with no parts is dropped. `turn` or `end` outside the available range
throws a `RangeError` naming the value and the count or length it exceeded.

Wiring a trigger straight to a saved conversation, using `continueConversation` inside `start`:

```ts
import type { Message } from "@mg/core";
import { createMemoryConversationStore } from "@mg/conversation";
import { continueConversation, runOnTrigger } from "@mg/runner";
import type { Trigger } from "@mg/trigger";
import config from "./loop-bash.config.ts";

type TweetInput = { kind: "tweet"; text: string };

const trigger: Trigger<TweetInput> = {
  decide: async (input) => ({
    fired: input.text.length > 0,
    reason: "has text",
  }),
};

const store = createMemoryConversationStore();
await store.create("jev");

const outcome = await runOnTrigger(
  {
    trigger,
    toMessages: (input): Message[] => [
      { role: "user", content: input.text },
    ],
    start: async (messages, options) => {
      if (messages.length === 0) {
        throw new Error("toMessages returned no messages");
      }
      const [first, ...rest] = messages;
      return continueConversation(
        config,
        {
          store,
          id: "jev",
          history: { kind: "all" },
          messages: [first, ...rest],
        },
        options,
      );
    },
    trace: { jsonlPath: "./trigger.jsonl" },
  },
  { kind: "tweet", text: "hello" },
);

if (outcome.fired) console.log(outcome.run.sessionId);
else console.log(outcome.decision.reason);
```

`toMessages` is typed to return `Message[]` — the same core message type `conversation.messages`
takes, so what it converts, system included, can go straight into `conversation.messages`.
`start` still receives a plain array (`Message[]`), not the non-empty tuple
`conversation.messages` needs, so it checks the length and rebuilds the tuple before calling
`continueConversation`.

Running as a persona, with `continueAsPersona` — `persona` here is a `Persona` built elsewhere
(e.g. with `@mg/persona`'s `createPersona`):

```ts
import { createMemoryConversationStore } from "@mg/conversation";
import { continueAsPersona } from "@mg/runner";
import config from "./loop-bash.config.ts";
import { persona } from "./jev.persona.ts";

const store = createMemoryConversationStore();
await store.create("t1");

const outcome = await continueAsPersona(
  config,
  {
    store,
    id: "t1",
    history: { kind: "all" },
    messages: [{ role: "user", content: "hi" }],
  },
  {
    persona,
    counterparts: [{ id: "alice", name: "Alice" }],
    input: "hi",
    trace: { jsonlPath: "./persona.jsonl" },
  },
);

if (outcome.saved) console.log(outcome.memory);
else console.log(outcome.reason);
```

`continueAsPersona` calls `persona.recall` for an instruction, puts it as a `system` message
ahead of `conversation.messages`, and runs the conversation through `continueConversation` with
that. When the append lands, it calls `persona.remember` with what was saved; `outcome.memory`
carries `remember`'s return value, or `{ updated: false, reason: "rejected", error }` if
`remember` itself rejects — the entrance never throws once the conversation is saved. `trace`
here is this entrance's own recording, separate from `config.trace`; see "Where results go"
below for the full outcome shape.

## 6. Where results go

- `run` returns `{ sessionId, result }`; `runMany` returns one outcome per case, each carrying
  its own `sessionId` and either `result` or `error`.
- `runOnTrigger` returns `{ fired: false, sessionId, decision }` when the trigger doesn't fire.
  When it fires, `run` is always `start`'s own return value, unchanged — `runOnTrigger` never
  calls a run entrance itself. The outcome is `{ fired: true, referenced: true, sessionId,
decision, run }` when the session id `start` returned matches the one the entrance decided,
  or `{ fired: true, referenced: false, sessionId, decision, expectedRunSessionId, run }` when
  it doesn't — reading `expectedRunSessionId` requires narrowing on `referenced`, not just
  `fired`. `sessionId` is the judgement session throughout. Only in the fired branch does the
  judgement's `mg.input` span carry `mg.run.session`, set to the session id the entrance
  decided and passed to `start`.
- `continueConversation` returns `{ saved: true, sessionId, result, entry }` when the append
  landed, where `entry` is the `ConversationEntry` that was appended (the same value passed to
  the store's `append`, not read back — when `options.keep` was given, this is the new
  messages followed by `keep`'s accepted answer; otherwise it is the new messages followed by
  everything the run added). When the run's returned conversation doesn't start with what was
  sent, it returns `{ saved: false, sessionId, result, reason: { kind: "diverged" } }` without
  calling `keep` or appending. When `options.keep` was given and its answer isn't `added` itself
  or a `keepDelivered` cut of it, it returns
  `{ saved: false, sessionId, result, reason: { kind: "not-in-result" } }`. When `keep` throws
  or rejects, it returns
  `{ saved: false, sessionId, result, reason: { kind: "keep-failed", error } }`, `error` being
  exactly what was thrown. When the append itself fails (e.g. another append landed first), it
  returns `{ saved: false, sessionId, result, reason: { kind: "append-failed", error } }` — it
  never throws for any of these cases, and none of them carries `entry`. `sessionId` and
  `result` come straight from the run; reading `reason` or `entry` requires narrowing on `saved`
  first, at the type level.
- `continueAsPersona` returns whatever `continueConversation` returned, plus `personaSessionId`
  (this entrance's own trace session id), `referenced` (and `expectedRunSessionId` when it's
  `false`, same meaning as `runOnTrigger`'s), and `recorded` (`{ ok: true }` or
  `{ ok: false, error }` for its own trace write-out). When `saved` is `true`, it also carries
  `memory` — `remember`'s return value, or `{ updated: false, reason: "rejected", error }` when
  `remember` itself threw. Reading `memory` requires narrowing on `saved` first, at the type
  level. The entrance rejects only before the conversation is saved: when the signal was already
  aborted, when `recall` threw, or when `continueConversation` threw. In the latter two cases, if
  the entrance's own trace write-out also fails, it still rejects with `recall`'s or
  `continueConversation`'s error, not the write-out failure.
- Trace spans go wherever `trace` in the config points: the JSONL file, the SQLite database,
  and/or any extra `exporters` — see `packages/trace/README.md` for how to read them back.
- Every span for one `run` call carries `mg.run.name` (the config's `name`). Spans from a
  `runMany` case also carry `mg.run.case` (that case's `id`). Filter on these to find a run.
- To judge a finished run from its trace, read the session back with a `TraceReader` and pass
  it to `@mg/eval`'s `evaluate`. See `packages/eval/README.md` and `runs/eval-example.ts`.

## 7. Rules

- One config per experiment. Don't reuse a single `runs/*.config.ts` for unrelated setups —
  add a new file instead.
- Change `name` whenever a config's contents change (model, tools, harness settings, trace
  target, …). `mg.run.name` is only useful for filtering if it stays tied to one setup.
- Don't put prompts in the config. Pass them as `messages` to `run` / `runMany` at call time.
