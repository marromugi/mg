# @mg/loop

Builds a loop harness that keeps calling tools until the model stops.

## Features

- Builds a harness that fits the @mg/harness types from a provider and tools.
- When a tool fails, reports the failure to the LLM and keeps going.
- Lets you receive results all at once or as a stream.
- When given a parent span, hangs its own spans under it.
- When given a gate, checks each tool call with it before running the tool.
- When given a list of subagents, shows them to the LLM next to the
  tools and routes each call by name.

## Usage

Build a harness from a provider and tools, then run it with a conversation.

```ts
import { createLoopHarness } from "@mg/loop";
import { collect } from "@mg/harness";

const harness = createLoopHarness({
  provider,
  model: "openai/gpt-4o-mini",
  tools: [bashTool],
  maxTurns: 10,
});

const result = await collect(
  harness({ messages: [{ role: "user", content: "..." }] }),
);
```

## API

### `createLoopHarness(options)`

Builds a harness.
Pass @mg/harness input to the returned function and it streams events.

Options:

| Name        | Description                                   |
| ----------- | --------------------------------------------- |
| `provider`  | Provider to use                               |
| `model`     | Model name                                    |
| `tools`     | Tools the model may call (optional)           |
| `subagents` | Subagents the model may call (optional)       |
| `maxTurns`  | Maximum number of turns                       |
| `stream`    | Whether to receive a stream (default `true`)  |
| `gate`      | Gate checked before each tool call (optional) |

## How it works

### The loop

The function returned by `createLoopHarness` repeats these steps.

- Calls the provider and emits the returned text and tool calls as events.
- If there are no tool calls, emits the finish event and ends.
- If there are tool calls, runs each one and adds the results to the
  conversation.
- Ends when it reaches the turn limit.

### Tool list in the request

Whether the request to the provider carries a tool list depends on
what was passed at build time.

- When `tools` or `subagents` is passed, every request carries a tool
  list. This holds even when both are empty lists, and then the list is
  empty.
- The list holds the tools first, then one entry per subagent, each in
  the order given.
- When neither is passed, the request carries no tool list.

### Wrap-up

When the input carries a wrap-up signal, the harness stops and keeps
the results so far.

- While generating, it passes the signal with every provider request.
- When the provider finishes with reason `halted`, generation stops.
  The text so far is added to the conversation as one assistant
  message.
- If that message has tool calls, none of them run. The results say
  they were not run.
- If a tool is running when wrap-up arrives, it fires that call's
  abort signal. It does not wait for the tool to finish.
- The result says the tool was stopped. Calls that finished earlier
  keep their real results.
- Tool calls in the same turn that have not started are not run.
  The results say they were not run.
- Subagent calls receive the wrap-up signal as is. The harness waits
  for the returned string and uses it as the result.
- It does not move on to the next turn. The stop reason is
  `wrapped-up`.

When the last turn ends without calling tools, the reason is `stop` or
`length`.

The abort signal takes precedence over wrap-up.
The wrap-up signal is optional.

### Hold

When the input carries a hold signal, the harness waits while it is
held. It waits at two points.

- Before a turn's generation starts.
- Once before the turn's tool calls start. The tool calls still start
  together after that wait.

A generation that is already streaming and tool calls that have
already started run to their end.

While waiting, wrap-up ends the run as described above, and the abort
signal throws as it does anywhere else. Subagent calls receive the
hold signal next to the wrap-up signal.

The hold signal is optional. Without it, nothing changes.

### Tool failures

When a tool fails, the harness turns the error into a tool result
instead of throwing. `toolErrorToMessage` does the conversion.
Only a stop caused by the abort signal (AbortSignal) is rethrown as is.

### Tracing

When the input carries a parent span, spans hang under it.

First it opens an `mg.harness` span.
Its `mg.harness.name` is `loop`.

The provider is wrapped with `traceProvider`.
Tool execution is wrapped with `traceRunToolCall`.

As a result, `mg.llm` and `mg.tool` spans appear underneath.
Without a parent span, none of this happens.

Without a parent span, neither the provider nor the tool runner is
wrapped. The `provider` passed at build time is used as is.

Right before stopping, it writes `mg.harness.stop_reason` to the
`mg.harness` span. The value is the same as the result's stop reason.

A failure to record does not change the harness's result.
When it ends with an exception, the span is closed without this
attribute.

### Gate

When a gate is passed at build time, each tool call is checked before
it runs. A rejected call does not run; the reason is returned as the
result.

With a parent span as well, the gate span `mg.gate` sits under
`mg.harness` as a sibling of the tool span `mg.tool`.
A rejected call gets no `mg.tool` span.

Without a gate, no check happens.

### Subagents

When a list of subagents is passed at build time, each subagent's name,
description and input schema are added to the tool definitions shown to
the LLM. They come after the tool definitions.

If the called name is in the subagent list, it runs as a subagent.
Otherwise it runs as a tool, as before. Gate checks and the conversion
of failures to text use the same code as tool calls.

If a tool and a subagent share a name, building the harness throws.
The same happens when two subagents share a name.

Without a subagent list, nothing changes.

## Non-goals

These are left to other packages.

- Harness input and event types: use @mg/harness.
- Tool implementations: pass them in from @mg/tools or elsewhere.
- Provider implementations: pass a provider that fits the @mg/core
  type.
- Tracing implementation: use the @mg/trace wrappers.
- Gate implementations: pass a gate built with @mg/gate.
