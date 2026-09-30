# @mg/gate

A package for gates, which decide whether a tool call or similar may run without asking a person.

## Features

- Sets the gate type.
  It receives a kind, a description, and the original value.
  It returns whether it is allowed, and a reason.
- Can build an implementation that decides with an LLM, from a policy text, a provider, and a model.
- Can also build an implementation that decides by probability, from an `Estimator` and a policy text.
- Can also build an implementation that decides by rules alone, from a root path and a list of rules.
- Can also build an implementation that combines a list of gates by asking them in order.
- Has a dedicated exception for when the decision itself fails.
- Has a wrapper that wraps tool execution and puts a decision before it runs.

## Usage

Build a gate, then pass it the request you want decided.

```ts
import { createLlmGate } from "@mg/gate";

const gate = createLlmGate({
  provider,
  model: "openai/gpt-4o-mini",
  policy: "読み取り専用のコマンドだけ、聞かずに実行してよい。",
});

const verdict = await gate.judge({
  kind: "tool-call",
  description: "Runs `bash` with command: rm -rf /",
});

// verdict is { allowed: boolean, reason: string }
```

## API

### `createLlmGate(options)`

`createLlmGate` takes a policy text, a provider, and a model.
It builds a gate from them.

Each time it decides, it queries the provider exactly once.
It sends the system instructions, the policy text, and what is to be decided.
What is to be decided is the description as passed.

The shape of the answer is fixed by forcing a call to a tool made only for deciding.
The value returned from that tool is validated and turned into allowed-or-not and a reason.

The table lists what you pass to `createLlmGate`.

| Name       | Contents                                 |
| ---------- | ---------------------------------------- |
| `provider` | The provider to use                      |
| `model`    | The name of the model to use             |
| `policy`   | The policy text the decision is based on |

If the decision itself fails, it throws `GateError`.
The original exception is kept in `cause`.

Only an abort signal is passed through as it is, without wrapping.
If you pass an already aborted signal in `context.signal`, it throws without calling the provider.

### `createEstimatorGate(options)`

`createEstimatorGate` takes a core `Estimator` and a policy text.
It builds a gate from them.

`Estimator` is the type for a model service that takes a subject and a question,
and returns the probability that the answer is "yes".
Which model service it talks to is up to the `Estimator` implementation you pass.
For example, you can pass core's `createJevEstimator`.

It asks only one thing: "Is it fine to run this action?"
If the returned probability is at or above the threshold, it allows. If below, it denies.

You can pass the threshold. If left out, it is 0.5.
The reason text shows neither the probability nor the threshold.
This is so the side calling the tool cannot aim at the threshold.

When the decision itself fails, the tool is not run.
This is the same as the LLM implementation.

The table lists what you pass to `createEstimatorGate`.

| Name        | Contents                                                     |
| ----------- | ------------------------------------------------------------ |
| `estimator` | The `Estimator` to use (from `@mg/core`)                     |
| `policy`    | The policy text the decision is based on                     |
| `threshold` | The probability needed to allow. From 0 to 1 (default `0.5`) |

```ts
import { createJevEstimator } from "@mg/core";
import { createEstimatorGate } from "@mg/gate";

const gate = createEstimatorGate({
  estimator: createJevEstimator({
    apiKey: process.env.TYPESAFE_API_KEY!,
  }),
  policy: "読み取り専用のコマンドだけ、聞かずに実行してよい。",
});

const verdict = await gate.judge({
  kind: "tool-call",
  description: "Runs `bash` with command: rm -rf /",
});

// verdict is { allowed: boolean, reason: string }
```

If the decision itself fails, it throws `GateError`.
Only an abort signal is passed through as it is, without wrapping.

Pass a finite number from 0 to 1 as the threshold.
If you pass a value outside that range, a `RangeError` is thrown when building.

### `createRulesGate(options)`

The rules implementation decides by the tool name and the reach the call touches.
It does not read the call's arguments.
It never queries a provider or any outside service.

`createRulesGate` takes a root path and a list of rules.
It builds a gate from them.

A rule has a list of tool names and a list of globs.
It also has a boolean for allow or deny, and a reason text.
Both the names and the globs can be left out.

It only decides requests whose kind is `tool-call`.
Other kinds are allowed as they are.

The table lists what you pass to `createRulesGate`.

| Name    | Contents                             |
| ------- | ------------------------------------ |
| `root`  | The root path the rules are based on |
| `rules` | The list of rules                    |

The fields of a single rule are also listed in a table.

| Name      | Contents                                         |
| --------- | ------------------------------------------------ |
| `tools`   | The list of target tool names (all if left out)  |
| `paths`   | The list of target globs (all if left out)       |
| `allowed` | `true` to allow, `false` to deny                 |
| `reason`  | The reason text (the default reason if left out) |

Pass a path that exists as `root`.
The example below assumes `/repo` exists.

```ts
import { createRulesGate } from "@mg/gate";

const gate = createRulesGate({
  root: "/repo",
  rules: [
    { tools: ["bash"], allowed: false },
    {
      paths: ["**/.env"],
      allowed: false,
      reason: "秘密の情報が入ったファイルには書かせない。",
    },
  ],
});

const verdict = await gate.judge({
  kind: "tool-call",
  description: "Writes to `sub/.env`",
  payload: {
    call: {
      id: "1",
      name: "write_file",
      arguments: { path: "sub/.env" },
    },
    reach: {
      kind: "paths",
      paths: [{ path: "/repo/sub/.env", extent: "file" }],
    },
  },
});

// verdict is { allowed: false, reason: "秘密の情報が入ったファイルには書かせない。" }
```

#### Reading the reach

The request contains the reach that the callee declared it touches.
The rules implementation looks only at this reach.
A call whose name is not found arrives as `any-local`.
A request with no reach attached is rejected with `GateError`.
A reach that breaks the shape `@mg/core` describes is also rejected with `GateError`, whatever the rules are.
The text names the first broken part and what was found there.
For example, a relative path reads `... reach.paths[0].path must be an absolute path, got "src/a.ts"`.

Before comparing, the root is made into an absolute path with links followed.
The root must be a path that exists.
Each path in `paths` is made relative to the resolved root and compared with the globs.
When the root cannot be resolved, it throws `GateError`.

How a rule with globs matches differs between deny rules and allow rules.

- A deny rule matches if it could match.
- An allow rule matches only when it surely matches.

The reach has one of these four shapes.

- `paths` is a list of local paths.
  Each path has an extent of `file` (that path only) or `tree` (everything under it).
- `any-local` is a reach that could touch anywhere locally.
- `outside` is a reach that touches no local path.
- `none` is a reach that touches nothing.

The table shows how each shape matches.

| Reach shape                   | Deny rule                                        | Allow rule     |
| ----------------------------- | ------------------------------------------------ | -------------- |
| `paths` (inside root, `file`) | Matches if the glob matches                      | Same           |
| `paths` (inside root, `tree`) | Matches if the glob matches or could match below | Does not match |
| `paths` (outside root)        | Matches whatever the extent                      | Does not match |
| `paths` (none)                | Does not match                                   | Does not match |
| `any-local`                   | Matches                                          | Does not match |
| `outside`                     | Does not match                                   | Does not match |
| `none`                        | Does not match                                   | Does not match |

When several paths are declared, they are handled like this.

- A deny rule matches if any one of them matches.
- An allow rule matches only when all of them match.

Whether a path under a `tree` could match is decided by splitting the glob on `/`.
It is matched against path segments from the start.
A `file` path is compared only as that path.

When the gate is built, globs that cannot be split into segments are rejected.
A glob containing any of these becomes a `RangeError`.

- A `{...}` or `(...)` group with `/` inside.
- A leading `/` or `./`, a trailing `/`, or an empty segment `//`.
- An escape `\`.

A rule with only tool names matches by name alone, without looking at the reach.

Rules are checked in order from the start of the list.
The first rule that applies decides allow-or-not and the reason.
If no rule applies, it allows.

#### Reason text

If the rule has a reason text, that is returned.
A rule without one gets a default reason.

| How it matched    | Default reason                                                       |
| ----------------- | -------------------------------------------------------------------- |
| Path inside root  | `Rule <i> <verb> <name> on <relative path>`                          |
| Path outside root | `Rule <i> <verb> <name> on <absolute path> (outside the root)`       |
| `any-local`       | `Rule <i> <verb> <name>: the paths it touches could not be decided.` |
| Reach not checked | `Rule <i> <verb> <name>`                                             |

`<verb>` is `allowed` or `denied`.
When there are several paths, the first one that matched in declared order is written.
For allow rules, it is the first path in declared order.

Only when it matched `any-local` is it built differently.
If the rule has a reason text, it is the default text, a space, and the reason text, in that order.

### `composeGates(gates)`

`composeGates` takes a list of gates.
It builds one gate from that list.

When you call judge, it asks each gate in the order passed.
It stops at the first gate that says "no".
It returns the allow-or-not and the reason from there as they are.

If every gate asked says "yes", it allows.
The reason text includes the number of gates asked.

When judge itself fails, it stops there.
The failure is thrown again as it is, and later gates are not asked.

If the list you pass is empty, it throws right away.

The combined gate does not record a span itself.
The inner gates record their own spans using the `context` passed in.

```ts
import { composeGates } from "@mg/gate";

const gate = composeGates([rulesGate, llmGate]);

const verdict = await gate.judge({
  kind: "tool-call",
  description: "Writes to `sub/.env`",
});

// if rulesGate says "no", llmGate is not asked
// if both say "yes", verdict is { allowed: true, reason: "All 2 gates allowed." }
```

Calling it with an empty list throws a `RangeError`.

### `gateRunToolCall(gate, run, parent)`

`gateRunToolCall` takes a function that runs tools,
and returns a function that puts a decision before running.

The tool call is built into the decision's input.
The kind is `tool-call`, and the description lists the tool's name, description, and arguments.
The original value holds the call, the tool definition, and `reach`.
The tool definition leaves out `execute` and `reach`.
`reach` is the reach the callee declared from the arguments.
A call whose name is not found gets `any-local`.

When the callee's declaration fails, it neither asks the gate nor runs the tool.
It returns the failure as the tool result.

If the decision is "yes", it calls the original run function as it is.
If "no", it does not run the tool and returns the reason as the tool result.
When the decision itself fails, it also does not run the tool,
and returns the failure as the tool result.
Only an abort signal (AbortSignal) is thrown again as it is, without wrapping.
If the signal you passed is already aborted, it is thrown again whatever the kind of failure.

The types of the caller and callee are set by type parameters.
The same wrapper can be used for subagent calls.

For that, you pass the list of subagents and `runSubagentCall` from `@mg/harness`.
The kind of request passed to the decision is `tool-call`, the same as for tool calls.
The original value holds the call, the subagent definition, and `reach`.
The definition leaves out `start` and `reach`.

The `tools` of a rules gate also apply to subagent names.
You can choose what to deny from the same list as tool names.
The reach a subagent declares is read with the same table.

`gateRunToolCall` takes a gate.
You can also pass a run function and a parent span.
If you leave out the run function, it uses `runToolCall` from `@mg/core`.
If you leave out the parent span, decisions are not recorded.

```ts
import { gateRunToolCall } from "@mg/gate";

const runToolCall = gateRunToolCall(gate, undefined, span);

const message = await runToolCall(tools, call, context);
// if the decision is "no", tools and call are not run
// if span is passed, the decision is recorded as mg.gate under span
```

## How it works

### Separating the type from implementations

It follows the same idea as the core provider.
A gate fixes its input and output with types.

The contents can be swapped.
The first implementation has an LLM read the policy text and decide.
An implementation that decides by rules alone can be built with the same type.

Because the type is fixed, the side that attaches a gate does not need to know its contents.
Swapping the contents requires no rewrite on the attaching side.

### Tracing

A gate records only when it receives a parent span.
It receives it through `GateContext.trace`.
It records its own decision as an `mg.gate` span.
Without one, it records nothing.

The LLM implementation keeps the call to the provider used for deciding.
It keeps it as an `mg.llm` span under `mg.gate`.

The Estimator implementation calls only one thing.
It keeps no child span, only `mg.gate`.

The Estimator implementation keeps the returned probability on `mg.gate`.
Anyone who can read the trace can see the probability.

The rules implementation makes no outside queries.
It keeps no child span, only `mg.gate`.

When you pass a parent span to `gateRunToolCall`,
it passes it as is to the gate for each tool call.
If you do not pass one, decisions are not recorded.

## Non-goals

- It does not plug into the harness loop or runner.
- It does not touch the screen for viewing traces.
- The combining implementation has no way to ask in parallel or to allow when any one gate allows.
