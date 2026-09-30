# @mg/runner

A package that builds a provider and a harness from a config file and runs them.

## Features

- Holds the config file type `RunConfig` and `defineRun`, which creates one.
- Holds `run`, which runs one config.
- Holds `runMany`, which runs several cases of a config together.
- Holds `loadRun`, which loads a config file from a path.
- Holds `continueConversation`, an entry point that runs the continuation of a saved conversation.
- Holds `continueAsPersona`, an entry point that runs the continuation of a conversation as a persona.

## Usage

How to write a config file, and the list of fields you can set, are in `agent-guide.md`.
This section shows only how to run one.

```ts
import { run } from "@mg/runner";
import config from "./loop-bash-gate.config.ts";

const { sessionId } = await run(config, [
  { role: "user", content: "..." },
]);
```

To run several cases together, use `runMany`.
To load a config file from a path, use `loadRun`.
To start a run from a trigger's decision, use `runOnTrigger`.
To run from the continuation of a saved conversation, use `continueConversation`.
To run from the continuation of a conversation as a persona, use `continueAsPersona`.

For the detailed meaning of each field and samples, see `agent-guide.md`.

## API

### `runOnTrigger(config, input, options)`

`runOnTrigger` is an entry point that checks one input and then starts a run.
The trigger you pass decides whether it fires.
The function you pass decides how the run is started.
runner knows neither what is inside the trigger nor how the run is started.

It takes three arguments: `config`, `input` and `options`.

The table lists the fields of `config`.

| Field        | Contents                                                                |
| ------------ | ----------------------------------------------------------------------- |
| `trigger`    | The @mg/trigger trigger that decides whether to fire.                   |
| `toMessages` | A function that turns the input into a list of messages.                |
| `start`      | A function that starts the run when it fires.                           |
| `trace`      | Trace settings for the decision record. Needs at least one destination. |

None of these has a default.

`input` is the input to check. It is limited to values that can be
turned into JSON.

`options` is optional. It may hold an abort signal (`signal`) and a
function that receives the run's events (`onEvent`).
Both are passed straight to `start`. The signal is also passed to the trigger.

`start` receives the converted messages and options holding the following.

- `sessionId`: the id of the run's session, decided by the entry point.
- `signal`: the abort signal passed by the caller.
- `onEvent`: the function passed by the caller that receives events.

`start` promises to return a value that holds the id of the run's session.
The basic use is to call the existing run entry point `run` inside `start`.

For each input, the entry point works in this order.

1. Opens the decision session and starts the input span `mg.input` as the root. Writes the input as JSON.
2. Has the trigger decide. Passes the input span as the parent.
3. If it does not fire, closes and exports the decision record and returns a not-fired result.
4. If it fires, turns the input into messages.
5. Decides the id of the run's session and writes it on the input span as a reference.
6. Closes and exports the decision record.
7. Calls `start` with the decided id, the signal and the event function, and waits for it to finish.

The shape of the return value depends on whether it fired and whether the reference was kept.

- When it did not fire: the decision session's id and the decision.
- When it fired and the reference was kept: the decision session's id, the decision and the return value of `start`.
- When it fired and the reference was broken: all of the above, plus the id the entry point decided.

The reference is kept when the id in the return value of `start` equals the id the entry point decided.
If they differ, the reference is broken. The entry point does not throw; it reports the broken reference through the shape of the return value.
In either shape, the return value of `start` is carried as is in `run`.

The decision record is a separate session from the run's record.
Whether it is stored in the same place as the run or elsewhere depends on the settings you pass.
It is closed and exported before the run starts, so you can read the decision record even while the run is in progress.

When the trigger throws, or when `toMessages` throws, the same error is rethrown.
In both cases, the input span is closed with the error first. The run is not started.

If exporting the decision record fails, it throws.
It throws the `TraceShutdownError` thrown by the close step as is.
The run is not started. If another error happened first, that one is thrown instead.

If `start` throws, the entry point rethrows the same error.
The decision record stays in a non-error state, holding its reference to the run.

### `continueConversation(config, conversation, options)`

`continueConversation` is an entry point that starts a run from the continuation of a saved conversation.
Conversations are saved with @mg/conversation's `ConversationStore`.
runner does not know the storage implementation. It only looks at the interface it is given.

The table lists what the entry point receives.

| Argument       | Contents                                               |
| -------------- | ------------------------------------------------------ |
| `config`       | The run's config. The same `RunConfig` as for `run`.   |
| `conversation` | Which conversation. Has the type `ConversationTarget`. |
| `options`      | The same options as `run`. Can be left out.            |

The fields `ConversationTarget` holds.

| Field      | Required | Contents                                |
| ---------- | -------- | --------------------------------------- |
| `store`    | Yes      | Where the conversation is saved.        |
| `id`       | Yes      | The id of the conversation to continue. |
| `history`  | Yes      | The range to read. There is no default. |
| `messages` | Yes      | The new messages.                       |

`messages` needs at least one message. It may include system messages.
They go to the run in the position written, and are saved in the entry as is.

For each call, the entry point works in this order.

1. If the abort signal is already aborted, it rejects with that reason. It does not read the conversation.
2. Reads the conversation in the given range. If reading fails, it throws that error as is.
3. Checks the new messages against the tool calls the read returned.
   If a new message holds a tool-call id that is already stored, it throws `ConversationToolCallIdError`.
   It does not start the run, and nothing is appended.
4. Places the new messages after the messages of the entries read, in this order.
   Saved system messages also stay in their positions.
5. Starts the run with that list. If the run fails, it throws that error as is.
6. Checks that the start of the resulting conversation equals the list it passed.
7. Appends the new messages and what the run added as one entry.
8. Returns the result.

Whatever reason the run ended for, the returned conversation is appended as is.
This is the same whether it stopped, hit the turn limit, or hit the length limit.

The shape of the return value depends on whether it could save.

| Shape                | Contents                                                                           |
| -------------------- | ---------------------------------------------------------------------------------- |
| Saved                | That it saved, the id of the run's session, the run's result, and the saved entry. |
| Start differed       | That it did not save, and the reason: the start did not match.                     |
| Answer not accepted  | That it did not save, and the reason: the answer was not accepted.                 |
| Keep function failed | That it did not save, the reason: the keep function failed, and the thrown error.  |
| Append failed        | That it did not save, the reason: the append failed, and the error it threw.       |

It fails to save for one of these four reasons.

- The start differed from the list it passed.
- The answer from `keep` was not accepted.
- `keep` threw or rejected.
- The append failed.

For every reason, nothing was appended.

The options it receives are passed as is to the run entry point.
If you pass `sessionId`, the session id in the return value is also that value.
The function passed to `onEvent` receives the run's events.
If you pass `wrapUp`, a run stopped by that signal is appended the same way.
If you pass `hold`, the run waits while it is held, and is appended once it goes on and ends.
If you pass `tools`, they go to the run as tools used only for that call.

#### Deciding what to keep

You can pass a function to the `keep` option.
When passed, that function decides what to keep.

The entry point calls `keep` after it checks that the start matches.
It passes the added messages as is and waits for the answer.
It calls it only once.
Until the answer comes, it does not append, even if the run has ended.

An accepted answer is a list equal to one of the following.

- All of the added messages.
- The added messages cut at some position.

A result cut at a position holds the following.

- The text up to that position.
- Every tool call and result.
- All of the reasoning.

A position is expressed as "which turn, and up to which character of its text".
Turns are counted over the assistant messages in the added messages, in order.

The diagram shows accepted and rejected answers.

```
Added messages:        A1[text "Hello there.", call c1]  T1  A2[text "It is queued. ..."]
Turn 0, character 5:   A1[text "Hello", call c1]  T1
Turn 1, character 5:   A1  T1  A2[text "It is"]
Rejected answer:       A1[call c1]  T1  A2[text "It is"]    drops earlier text
Rejected answer:       A1[text "Hello there."]  T1  A2      drops a call
```

An answer may match neither a cut at a position nor the whole.
In that case it does not append, and returns the reason.
The return value is `{ saved: false, reason: { kind: "not-in-result" } }`.

When `keep` throws or rejects, it does not append either.
The return value is `{ saved: false, reason: { kind: "keep-failed", error } }`.
`error` holds the thrown value as is.

When `keep` is not passed, all of the added messages are appended.

The helper `addedMessages`, which cuts out the continuation of a conversation, is also exported.
It compares the list you passed with the resulting conversation, and returns the added messages or a start mismatch.
It can be checked on its own, without a run.

The helper `keepDelivered`, which cuts the added messages at the position reached, is also exported.
It takes the added messages and a position, and returns what to keep. It is a pure function with no input or output.
An answer `keep` returns must equal one of this helper's return values.
If the position is outside the list, it throws `RangeError`.

The function that creates the entry point, `createContinueConversation`, is also exported.
It takes the function that runs from outside and builds the entry point.
The exported `continueConversation` is made by passing the existing `run`.

### `continueAsPersona(config, conversation, persona, options)`

`continueAsPersona` is an entry point that chains recall, the run of the conversation's continuation, and reflection, in this order.
A persona is a single agent that has a personality and keeps living. It is represented by @mg/persona's `Persona`.
runner only looks at the `Persona` interface and does not know what is inside.

The table lists what the entry point receives.

| Argument       | Contents                                                         |
| -------------- | ---------------------------------------------------------------- |
| `config`       | The run's config. The same `RunConfig` as for `run`.             |
| `conversation` | Which conversation. The same type as for `continueConversation`. |
| `persona`      | Which persona. Has the type `PersonaTarget`.                     |
| `options`      | The same options as `run`. Can be left out.                      |

The fields `PersonaTarget` holds.

| Field          | Contents                                                             |
| -------------- | -------------------------------------------------------------------- |
| `persona`      | The persona itself, which holds recall and reflection.               |
| `counterparts` | The list of counterparts. Each has an id and a display name.         |
| `input`        | The current input for recall.                                        |
| `trace`        | Trace settings for this entry point. Needs at least one destination. |

For each call, the entry point works in this order.

1. If the abort signal is already aborted, it rejects with that reason. It starts neither recall nor recording.
2. Opens the persona session and starts the `mg.persona` span as the root.
3. Decides the id of the run's session. Uses the one in the options if present, otherwise creates a new one.
4. Calls recall. If it throws, closes the root with that error. Exports the record, then throws the same error.
5. Turns recall's instructions into a system message, puts it at the start of the new messages, and calls the conversation entry point.
6. If the conversation entry point throws, it is handled the same as in step 4. No reflection is done.
7. If the conversation could not be saved, no reflection is done. Closes the root, exports the record and returns.
8. If it was saved, calls reflection with the saved entry and what recall read.
9. Closes the root and exports the record. It does not throw even if exporting fails.

When recall or the conversation entry point fails, the record is closed with that error. If exporting also fails, it throws the earlier error.
Once the conversation is saved, this entry point does not throw. This is so the saved result is not lost.
Even if reflection throws, this entry point does not throw. The result carries it as a reason the update failed: "rejected".

The `wrapUp`, `hold` and `tools` options are passed as is to the conversation continuation entry point.
`keep` is passed the same way.
Reflection receives the entry saved with the answer from `keep`.

The attributes of the `mg.persona` span.

| Attribute                 | Contents                                       |
| ------------------------- | ---------------------------------------------- |
| `mg.persona.id`           | The persona's id.                              |
| `mg.persona.conversation` | The conversation's id.                         |
| `mg.persona.counterparts` | JSON of the counterparts' ids.                 |
| `mg.run.session`          | The id of the run's session.                   |
| `mg.persona.referenced`   | Whether the reference was kept.                |
| `mg.persona.saved`        | Whether the conversation was saved.            |
| `mg.persona.updated`      | When saved, whether reflection made an update. |

The return value is the conversation entry point's return value plus the following.

| Field              | Contents                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------- |
| `personaSessionId` | The id of the persona session.                                                            |
| `referenced`       | Whether the reference was kept. When it was broken, it also holds `expectedRunSessionId`. |
| `recorded`         | Whether the record could be exported.                                                     |
| `memory`           | Reflection's return value. Present only when the conversation was saved.                  |

To read `memory`, first check `saved` to narrow the type. The types express this.

The function that creates the entry point, `createContinueAsPersona`, is also exported.
It takes the conversation entry point from outside and builds the entry point.
The exported `continueAsPersona` is made by passing the existing `continueConversation`.

### `defineSubagent(config)`

Subagents are written in the run's config.
`run` is what builds them.
The config type is `SubagentConfig`.
There is also `defineSubagent`, which returns the config as is.

The config has the following fields.

| Field         | Required    | Contents                                                           |
| ------------- | ----------- | ------------------------------------------------------------------ |
| `name`        | Yes         | The name shown to the LLM.                                         |
| `description` | Yes         | The description shown to the LLM.                                  |
| `system`      | No          | The system prompt placed at the start of the child conversation.   |
| `provider`    | Yes         | The provider the child uses.                                       |
| `harness`     | Yes         | The child's harness config. Same type as `harness` in `RunConfig`. |
| `tools`       | No          | The tools the child uses.                                          |
| `gate`        | Conditional | Checks calls inside the child.                                     |
| `workspace`   | No          | How a workspace is passed to the child. See the table below.       |

`gate` is required when `tools` or `workspace` is written.
A config with neither passes the type check without `gate`.

Anything not written in the config does not reach the child.
The provider, gate and tools are not filled in from the parent's config.

#### How the child receives a workspace

The config's `workspace` decides how a workspace is passed to the child.
There are three ways.

| Way            | How to write          | Contents                                          |
| -------------- | --------------------- | ------------------------------------------------- |
| None           | Leave out `workspace` | Uses no workspace.                                |
| Fixed          | `{ pick: "fixed" }`   | Uses the source written in the config every time. |
| Parent chooses | `{ pick: "caller" }`  | The parent LLM chooses the source on each call.   |

There are two kinds of source.

| Source   | How to write                 | Contents                                                          |
| -------- | ---------------------------- | ----------------------------------------------------------------- |
| Parent's | `{ kind: "parent" }`         | Borrows the parent's open workspace. The child does not close it. |
| Own      | `{ kind: "own", workspace }` | Opens and closes the config's workspace on every start.           |

The source may say the parent's, while the run has no `workspace`.
In that case, it throws when the run starts.
With "parent chooses", if source names overlap, it also throws when the run starts.

With "parent chooses", a `workspace` argument is added to the input schema.
Its value is an enum of source names.
An own source is named by its workspace's name; the parent's source is named by the parent's workspace's name.

Whether it is required is set by the config's `required`.
With an optional setting, if the argument is left out, the child runs without a workspace.

If opening its own workspace fails, that failure is thrown as is.
The child's provider is not called.

A tool name in the config may overlap with a tool name from the workspace.
In that case, it closes what it opened and then throws.

When the child fails, it also closes what it opened, then throws the child's failure.
If closing fails too, it throws the child's failure.

The child may succeed while only closing fails.
In that case, it throws a dedicated exception.
Its name is `SubagentCloseError`.
Its message includes the child's answer and the reason closing failed.

The table sums up the exceptions from building and running.

| Exception                | When                                                         |
| ------------------------ | ------------------------------------------------------------ |
| `InvalidRunConfigError`  | A source or a name overlap was wrong.                        |
| `ConnectorOpenError`     | Its own workspace could not be opened.                       |
| `DuplicateToolNameError` | A tool name overlapped between the config and the workspace. |
| `SubagentCloseError`     | The child finished, but closing failed.                      |

The span of its own workspace sits under the span in the context passed to `start`.
It is a sibling of the child harness's span.

### `createRunQueue(run, options)`

`createRunQueue` creates a queue that runs queued inputs one at a time.

This queue sits between the caller and the function that runs.

```
caller ──enqueue──▶ queue ──one at a time──▶ run function
   ▲                  │
   └── start / event / end ──┘
```

`createRunQueue` takes one run function and creates a queue.
The caller prepares the run function by wrapping an existing entry point.
The queue does not know what is inside the entry point.

```ts
import { continueConversation, createRunQueue } from "@mg/runner";
import config from "./loop-bash-gate.config.ts";
import { toTarget } from "./to-target.ts";

const queue = createRunQueue((input: string, options) =>
  continueConversation(config, toTarget(input), options),
);

const { id, ending } = queue.enqueue("hello");
console.log(id, await ending);
```

Within one queue, runs happen one at a time.
They start in the order queued, and the next starts only after the previous run function has returned.

`enqueue` returns an id right away.
The id is a 21-character string and is passed to the run function as `sessionId`.
You know the id of the run's session before it runs.

To queue at the front, pass the following.

```ts
queue.enqueue(input, { first: true });
```

It goes before the waiting items and after the running item.

For each queued item, a value that describes how it ended arrives in `ending`.
It does not throw.

| Ending  | Value                                   | Contents                                               |
| ------- | --------------------------------------- | ------------------------------------------------------ |
| Success | `{ kind: "finished", outcome }`         | The value the run function returned.                   |
| Failure | `{ kind: "failed", error }`             | The value the run function threw or rejected with.     |
| Dropped | `{ kind: "dropped", reason: "closed" }` | An item that did not run because the queue was closed. |

If an item fails, the queue does not stop; it starts the next item.

You can pass `onStart` and `onEvent` as the second argument.
They receive the start and events of each run, with the item's id.

`queue.wrapUp()` sends the wrap-up signal only to the item running now.
It returns `true` if it sent one, and does nothing and returns `false` if nothing is running.
It does not send the signal to waiting items.

`queue.hold()` holds the queue, and `queue.release()` lets it go on.
The queue has one hold for its whole life, and every run receives its signal as `hold`.
A held queue holds the running item, and it holds the items that start later.
The hold lasts across items until `release()`.

`queue.close()` drops the waiting items without running them and finishes.
The running item runs to the end, and `close()` resolves after waiting for it.
A running item that is held counts too: `close()` waits until it is released or wrapped up.
Items queued after closing are also dropped without running.

## How it works

### Run flow

The steps `run` goes through before it returns a result.

- Creates the trace SDK from the config's `trace`.
- If the config has a `workspace`, opens it before the run and passes its tools to the harness.
- If the config has `subagents`, passes the workspace and builds the subagents.
- Builds the harness to match the config's `harness.kind`. Also passes it the built subagents.
- Passes the config's `gate` to the harness as is.
- If `tools` are passed on the call, adds them after the list of tools.
- If `wrapUp` is passed on the call, passes it to the harness as is.
- If `hold` is passed on the call, passes it to the harness as is.
- Passes the conversation to the harness, collects the events and makes the result.
- Closes the opened workspace. It closes it even if the run fails.
- Closes the root span, waits for the trace export, then returns.

### Gate

A config can include a gate, `gate`, that decides whether a call may run.
When included, the harness is built to run that check before running a tool.
runner does not know the gate's implementation.
You pass a gate made with @mg/gate straight into the config.

A config that includes `tools` or `workspace` requires `gate`.
Without it, the type check fails. It is required even for an empty list of tools.

Values that do not pass the type check are also rejected at run time under the same condition.
`loadRun` rejects a config that has `tools` or `workspace` but no `gate`,
with `InvalidRunConfigError`.
The message is `<path>: gate is required when tools or workspace is set`.

`loadRun` also rejects a config whose `provider.toolForcing` is missing or is not
`true` or `false`, with `InvalidRunConfigError`.
The message is `<path>: provider.toolForcing must be a boolean`.

`run`, `continueConversation` and `continueAsPersona` also check the same
condition before starting anything.
If the config has `tools` or `workspace` but no `gate`,
they throw `GateRequiredError`.
The message is `gate is required when tools or workspace is set`.

Tools may also be added to the call.
If the config has no `gate`, that also throws `GateRequiredError`.
The message is `gate is required when tools are added to the call`.
When both apply, the first message is used.

How to write it is in `agent-guide.md`.

### Workspace

When a config includes a workspace, `workspace`, it is opened before the run.
Its tools are placed after the config's tools and passed to the harness.

After the run, the workspace is closed. It is closed even if the run fails.
If a config tool and a workspace tool share a name, the workspace is closed and then it throws.
If closing the workspace fails, it throws even if the run succeeded.

`runMany` calls `run` for each case. So the workspace is also opened and closed for each case.
Sharing one workspace across several cases is not possible yet.

Even with a workspace in the config, `concurrency` can sometimes be 2 or more.
What decides it is the workspace connectors' declaration of what they hold exclusively.
A workspace that a subagent holds as its own is looked at the same way.

If the declaration has no names, any number run in parallel.
If it has even one name, set `concurrency` to 1.
If you pass 2 or more, it throws without running any case.
The exception message includes the workspace's name and the names it holds exclusively.

How to write it is in `agent-guide.md`.

### Extra tools

Each call to `run` can pass tools used only for that call. This is `options.tools`.

The passed tools are placed after the config's tools and the workspace's tools, and passed to the harness.
Unlike the config's tools, a different set can be passed on each call.

If a name overlaps with a config tool or a workspace tool, the workspace is closed and then it throws.
The exception is `DuplicateToolNameError`. It holds the name of the overlapping side and `"options"`.

The gate written in the config also checks calls to the added tools.

There is no way to pass extra tools to `runMany` or `runOnTrigger`.

### Tracing

`run` records one run as an `mg.run` span.
Its `mg.run.name` holds the config's `name`.

When run from `runMany`, `mg.run.case` also holds the case's ID.
If exporting the trace fails, it throws.
Even if the run succeeded, it throws `TraceShutdownError`.

The period of opening and closing the workspace is recorded as an `mg.workspace` span.
`mg.workspace` sits directly under `mg.run`.
`mg.workspace` is also a sibling of `mg.harness`.

The `mg.run` span ends after the workspace has finished closing.
If closing the workspace fails, the failure stays on `mg.workspace`.
The same failure also stays on the `mg.run` span as an error.

### Building subagents

A subagent is a run of another harness.
A harness starts it in response to an LLM call.
The interface is in @mg/harness.

A built subagent's input schema is only the string `prompt`.
The child conversation starts with `system` as a system message, if present.
Then `prompt` is passed as a user message.

The string it returns depends on how the child ended.

- If the child ran to the end and has final text, it returns that text as is.
- If there is no text, it returns a fixed message saying the result was empty.
- If the child hit the turn limit, it returns a fixed message with the last text before the limit attached.
- If the child's output was cut at the length limit, it returns a fixed message with the cut text attached.
- If the caller wrapped the child up, it returns a fixed message with the
  text so far attached.
- In each case, if the attached text is empty, the message says it was empty.

Tool calls inside the child are checked by the config's `gate`.
If the context passed to `start` has a span, the child harness's span sits under it.
The context's abort signal is passed straight to the child harness.
The context's wrap-up signal is also passed straight to the child harness.
The context's hold signal is passed the same way.

If the `harness` config is wrong, it throws when the run starts.
This is so it is checked before the run starts, not partway through.

The run config `RunConfig` can include `subagents`.
It lists subagent configs.
A config that leaves it out behaves as before.

`run` builds the subagents from this list after opening the workspace.
It passes the built subagents to the harness.

#### Concurrency and queueing

An own workspace may have names that it holds exclusively.
The names are found with `exclusiveNamesOf` from `@mg/workspace`.

If there are no names, any number open at the same time.

If there is even one name, all of the names are acquired before opening.
Until they can be acquired, it waits in arrival order.
Even two workspaces written separately enter the same queue if their names overlap.

Acquired names are released after closing finishes.
They are released even if closing fails.

One queueing state is created per run.
`run` passes the same state to every subagent.
All subagents in one run share the same queue.
Because it is shared, even separate subagents wait on each other when names overlap.

If an abort signal comes while waiting, it ends with an abort exception without opening.
There is no time limit on waiting.

An own workspace's name may overlap with the run's workspace's name.
The run holds that name for the whole run.
Left as is, the wait would never end.
So it is a config error when the run starts.

## Non-goals

These things are left outside runner.

- It does not hold harness implementations. It builds them from @mg/loop and others according to `harness.kind`.
- It does not hold provider or tool implementations. They are passed from @mg/core or @mg/tools.
- It does not hold the decision of whether a call may run. You pass a gate made from @mg/gate.
- It does not hold the decision of whether a run should start. You pass a trigger made from @mg/trigger.
- It does not hold the trace implementation. It uses the @mg/trace SDK.
- It does not hold workspace implementations. It only opens and closes the workspace passed from @mg/workspace.
- It does not hold running from the command line.
