# @mg/harness

A package that sets the shared input and output types every harness follows, whatever it is.

A harness is something that connects an LLM and tools to get work done.
This package only sets the shape.
It does not decide how the work proceeds.

## Features

- Sets the type of the input passed to a harness.
- Sets the type of the events a harness returns in order.
- Has a function that takes a stream of events and pulls out only the final result.
- Has the subagent interface and a function that runs a subagent call.

## Usage

A harness author writes a function of this shape.

```ts
import type { Harness } from "@mg/harness";
import { collect } from "@mg/harness";

const harness: Harness = async function* (input) {
  yield { type: "text-delta", delta: "こんにちは" };
  yield {
    type: "done",
    result: {
      reason: "stop",
      messages: input.messages,
      usage: { inputTokens: 0, outputTokens: 0 },
    },
  };
};

const result = await collect(harness({ messages: [] }));
```

## API

### Input

You pass the conversation history to a harness.
You can also pass a signal (AbortSignal) to stop it midway.
You can also pass a wrap-up signal (AbortSignal).
You can also pass a hold signal (`HoldSignal`).
You can pass a parent span too, or leave it out.

Wrapping up is a different signal from aborting.
Use it when you want the harness to stop while still returning the conversation so far as the result.
Both can be left out.
How a harness stops on wrap-up is up to the harness implementation.

The hold signal is different again.
Holding pauses a run and can be undone, while wrapping up ends it.
The signal says whether it is held, and `released()` gives a promise that settles once it is released.
It settles at once when nothing is held.

You turn a hold on and off with a hold controller.
It has the same split as an abort controller.
The controller changes the state, and its signal only reads it.

```ts
const hold = createHoldController();
hold.hold();
hold.release();
const input = { messages: [], hold: hold.signal };
```

A span can create child spans.
It can also create a new root span in the same session.
A new root span has no parent.
Its trace ID differs from the original span's.
Its session ID is the same as the original span's.

### Events

A harness is a function that takes the input and returns events.
The event names are listed below.

```
text-delta   a piece of text arrived
tool-call    a tool call arrived
tool-result  a tool result arrived
turn         one exchange finished
done         the whole harness finished
```

The event for the end of the whole run carries three things.

- The reason it ended.
- The conversation so far.
- The usage.

The reason it ended is one of these four.

| Reason       | Meaning                                               |
| ------------ | ----------------------------------------------------- |
| `stop`       | The LLM returned an answer without calling tools.     |
| `max-turns`  | The limit on exchanges was reached.                   |
| `length`     | The LLM's output was cut off by the length limit.     |
| `wrapped-up` | It stopped midway after receiving the wrap-up signal. |

### `collect(events)`

`collect` reads the stream of events in order.
When the event for the end of the whole run arrives, it returns the result inside.
If the stream ends without that event, it throws.

### `Subagent`

A subagent is a run of another harness.
A harness starts it in response to an LLM call.
To the parent LLM, it looks the same as a tool.

The subagent type has these fields.

- The name shown to the LLM.
- The description shown to the LLM.
- The input schema.
- The prepare function.

The prepare function receives the validated input.
It gives back a prepared call that holds the reach the call declares
and the run function bound to that reach.
The run function receives a context (`SubagentContext`).
It returns a string.

The context has these four things.

- The abort signal (`AbortSignal`).
- The wrap-up signal (`AbortSignal`).
- The hold signal (`HoldSignal`).
- The span.

The wrap-up signal is a different signal from the abort signal.
It is passed from the parent harness and can be left out.
How the child stops is up to the subagent implementation.

### `prepareSubagentCall(subagents, call)`

`prepareSubagentCall` is a function that prepares one call.
It works in this order.

1. Finds the subagent whose name matches.
2. Validates the input.
3. Calls the subagent's prepare function.

It gives back a prepared call for every call.
For an unknown name or invalid input, the prepared call declares `any-local`,
and its run function throws the errors below.
These do not extend the core tool errors.

- `SubagentNotFoundError` is thrown when no name matches.
- `SubagentInputError` is thrown when validation fails. It also carries the issues found.

### `runSubagentCall(subagents, call, context)`

`runSubagentCall` prepares the call, runs it,
turns the returned string into a tool message and returns it.
If you call it without a context, the run function receives an empty context.

## Non-goals

The following are left to code outside harness.

- It has no way of proceeding that repeats tool calls. That is the job of loop and similar packages.
- It does not talk to providers. Talking to the LLM is core's job.
- It has no tool implementations.
- It has no subagent contents. Outside code such as runner provides them.
