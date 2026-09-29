# @mg/trace

A package that holds the tracing implementation and a shared vocabulary.

A harness receives a parent span through its input.
This package holds the implementation of that span.

## Features

- Holds the tracing implementation and the vocabulary.
- Wraps an LLM provider and records each call.
- Wraps a tool's run function and records each run.
- Holds the SDK and the exporters that carry traces out.
- A reader returns a saved trace as a tree.

## Usage

This example creates a parent span from the SDK and passes it to a harness.
Traces are saved to SQLite.

```ts
import { createTraceSdk } from "@mg/trace/otel";
import { startRootSpan } from "@mg/trace";
import { collect } from "@mg/harness";
import { createLoopHarness } from "@mg/loop";

const sdk = await createTraceSdk({ sqlitePath: "./trace.db" });
const trace = startRootSpan(sdk.tracer, "run");

const harness = createLoopHarness({
  provider,
  model: "openai/gpt-4o-mini",
  maxTurns: 10,
});

const result = await collect(
  harness({ messages: [{ role: "user", content: "..." }], trace }),
);
trace.end();
await sdk.shutdown();
```

## API

### Three entry points

There are three entry points.
The table lists what each one holds and what it depends on.

| Entry point       | Holds                                                | Depends on                       |
| ----------------- | ---------------------------------------------------- | -------------------------------- |
| `@mg/trace`       | Tracing implementation, vocabulary, wrappers         | OpenTelemetry API, harness, core |
| `@mg/trace/otel`  | SDK and exporters                                    | `@mg/trace`, OpenTelemetry SDK   |
| `@mg/trace/store` | Trace and tree types, reader type, table definitions | drizzle, libsql                  |

This entry point does not load the OpenTelemetry SDK.
It lets you work with the shape of a trace, apart from the exporters.

trace uses harness and core.
harness does not know about trace.

### Readers

Each storage backend has something that reads traces.
The reader type is `TraceReader`.
It lives in `@mg/trace/store`.

A reader returns the traces of one session as a tree.
The shape is the same whatever the storage backend.

| Reader              | Reads           |
| ------------------- | --------------- |
| `JsonlTraceReader`  | A JSONL file    |
| `SqliteTraceReader` | SQLite database |

### Vocabulary

Every name written to a trace starts with `mg.`.
There are 13 shared span names.

| Constant          | Name            | Meaning                                  |
| ----------------- | --------------- | ---------------------------------------- |
| `SPAN.harness`    | `mg.harness`    | Span for the whole harness               |
| `SPAN.llm`        | `mg.llm`        | Span for an LLM call                     |
| `SPAN.tool`       | `mg.tool`       | Span for a tool run                      |
| `SPAN.run`        | `mg.run`        | Span for one run                         |
| `SPAN.gate`       | `mg.gate`       | Span for a gate check                    |
| `SPAN.workspace`  | `mg.workspace`  | Span for opening and closing a workspace |
| `SPAN.subagent`   | `mg.subagent`   | Span for a subagent call                 |
| `SPAN.thread`     | `mg.thread`     | Span for a child conversation            |
| `SPAN.input`      | `mg.input`      | Root span while handling one input       |
| `SPAN.trigger`    | `mg.trigger`    | Span for a trigger check                 |
| `SPAN.persona`    | `mg.persona`    | Root span for the persona entry point    |
| `SPAN.recall`     | `mg.recall`     | Span for recall                          |
| `SPAN.reflection` | `mg.reflection` | Span for reflection                      |

Spans specific to one harness start with `mg.<harness name>.`.

A call span sits under the parent span it was given.
A thread span is a new root in the same session.
It does not sit under the parent's tree.

The table below lists the attribute names.

| Constant                        | Name                            | Meaning                                                                                                                            |
| ------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `ATTR.op`                       | `mg.op`                         | Kind of span (harness / llm / tool / run / gate / workspace / subagent / thread / input / trigger / persona / recall / reflection) |
| `ATTR.harnessName`              | `mg.harness.name`               | Name of the harness                                                                                                                |
| `ATTR.harnessStopReason`        | `mg.harness.stop_reason`        | Why the harness stopped (stop / max-turns / length / wrapped-up)                                                                   |
| `ATTR.runName`                  | `mg.run.name`                   | Name of the config                                                                                                                 |
| `ATTR.runCase`                  | `mg.run.case`                   | ID of the case                                                                                                                     |
| `ATTR.runSession`               | `mg.run.session`                | ID of the session passed to the started run (written on the input span)                                                            |
| `ATTR.workspaceName`            | `mg.workspace.name`             | Name of the workspace                                                                                                              |
| `ATTR.workspaceConnectors`      | `mg.workspace.connectors`       | List of connector kinds (JSON string)                                                                                              |
| `ATTR.workspaceTools`           | `mg.workspace.tools`            | List of names of the tools it produced (JSON string)                                                                               |
| `ATTR.llmModel`                 | `mg.llm.model`                  | Name of the model used                                                                                                             |
| `ATTR.llmProvider`              | `mg.llm.provider`               | Name of the provider (left out when there is no name)                                                                              |
| `ATTR.llmStream`                | `mg.llm.stream`                 | Whether the response was streamed                                                                                                  |
| `ATTR.llmFinishReason`          | `mg.llm.finish_reason`          | Why the call finished                                                                                                              |
| `ATTR.llmInputTokens`           | `mg.llm.usage.input_tokens`     | Number of input tokens                                                                                                             |
| `ATTR.llmOutputTokens`          | `mg.llm.usage.output_tokens`    | Number of output tokens                                                                                                            |
| `ATTR.llmInputMessages`         | `mg.llm.messages.input`         | Messages sent (JSON string)                                                                                                        |
| `ATTR.llmOutputMessages`        | `mg.llm.messages.output`        | Messages returned (JSON string)                                                                                                    |
| `ATTR.toolName`                 | `mg.tool.name`                  | Name of the tool                                                                                                                   |
| `ATTR.toolCallId`               | `mg.tool.call_id`               | ID of the call                                                                                                                     |
| `ATTR.toolArguments`            | `mg.tool.arguments`             | Arguments passed (JSON string)                                                                                                     |
| `ATTR.toolResult`               | `mg.tool.result`                | Result of the run                                                                                                                  |
| `ATTR.gateKind`                 | `mg.gate.kind`                  | Kind of thing checked                                                                                                              |
| `ATTR.gateDescription`          | `mg.gate.description`           | Description of the thing checked                                                                                                   |
| `ATTR.gateAllowed`              | `mg.gate.allowed`               | Whether it was allowed                                                                                                             |
| `ATTR.gateReason`               | `mg.gate.reason`                | Reason for the decision                                                                                                            |
| `ATTR.gateModel`                | `mg.gate.model`                 | Name of the model used for the check (LLM implementation only)                                                                     |
| `ATTR.subagentName`             | `mg.subagent.name`              | Name of the subagent                                                                                                               |
| `ATTR.subagentCallId`           | `mg.subagent.call_id`           | ID of the call                                                                                                                     |
| `ATTR.subagentArguments`        | `mg.subagent.arguments`         | Arguments passed (JSON string)                                                                                                     |
| `ATTR.subagentResult`           | `mg.subagent.result`            | String the child returned                                                                                                          |
| `ATTR.threadId`                 | `mg.thread.id`                  | ID of the thread                                                                                                                   |
| `ATTR.inputValue`               | `mg.input.value`                | The input (JSON string)                                                                                                            |
| `ATTR.triggerFired`             | `mg.trigger.fired`              | Whether it fired                                                                                                                   |
| `ATTR.triggerReason`            | `mg.trigger.reason`             | Reason for the decision                                                                                                            |
| `ATTR.triggerModel`             | `mg.trigger.model`              | Name of the model used for the check                                                                                               |
| `ATTR.triggerProbability`       | `mg.trigger.probability`        | Probability                                                                                                                        |
| `ATTR.triggerThreshold`         | `mg.trigger.threshold`          | Threshold                                                                                                                          |
| `ATTR.personaId`                | `mg.persona.id`                 | ID of the persona                                                                                                                  |
| `ATTR.personaConversation`      | `mg.persona.conversation`       | ID of the conversation                                                                                                             |
| `ATTR.personaCounterparts`      | `mg.persona.counterparts`       | List of counterpart IDs (JSON string)                                                                                              |
| `ATTR.personaSaved`             | `mg.persona.saved`              | Whether the conversation was saved                                                                                                 |
| `ATTR.personaUpdated`           | `mg.persona.updated`            | Whether memory was updated                                                                                                         |
| `ATTR.personaReferenced`        | `mg.persona.referenced`         | Whether the reference to the run's session was kept                                                                                |
| `ATTR.recallModel`              | `mg.recall.model`               | Name of the model used for the check                                                                                               |
| `ATTR.recallCandidates`         | `mg.recall.candidates`          | Number of candidate items                                                                                                          |
| `ATTR.recallSelected`           | `mg.recall.selected`            | List of IDs of the selected items (JSON string)                                                                                    |
| `ATTR.recallProbabilities`      | `mg.recall.probabilities`       | Probability per label (JSON string)                                                                                                |
| `ATTR.reflectionModel`          | `mg.reflection.model`           | Name of the model used for the check                                                                                               |
| `ATTR.reflectionCandidates`     | `mg.reflection.candidates`      | Number of candidates                                                                                                               |
| `ATTR.reflectionKept`           | `mg.reflection.kept`            | Number kept                                                                                                                        |
| `ATTR.reflectionPersonaChanged` | `mg.reflection.persona_changed` | Whether the persona was rewritten                                                                                                  |
| `ATTR.reflectionForgotten`      | `mg.reflection.forgotten`       | List of IDs of the removed items (JSON string)                                                                                     |

Attribute values are strings, numbers and booleans only.
A value with structure is stored as a JSON string.

## How it works

### Sessions

Traces are grouped into units called sessions.
The session id is set when `createTraceSdk` creates the SDK.

If one is passed in the input, that value is used; otherwise a new one is created.
The continuation of the same conversation keeps using the same SDK.

One session can hold several traces.
A span's `startRoot` creates a new root in the same session.
The new root span has no parent.
Its trace ID differs from the original span's.
Its session ID is the same as the original span's.

The session id goes into a resource attribute.
The table shows it together with the service name.

| Attribute      | Meaning             |
| -------------- | ------------------- |
| `session.id`   | ID of the session   |
| `service.name` | Name of the service |

### Where records are written

The record of an LLM call is written by a wrapper around the provider.
That wrapper is `traceProvider`.

The record of a tool run is written by a wrapper around the run function.
That wrapper is `traceRunToolCall`.

The record of a subagent call is written by a wrapper around the run function.
That wrapper is `traceRunSubagentCall`.
It puts the call span under the parent span it was given, and creates a new
thread span that becomes the root of the child conversation.
Both spans carry the same thread ID as an attribute.

The harness itself writes only its own records.
If recording fails, the harness does not stop.

Gate records are written by `@mg/gate`.
It writes a check as `mg.gate` only when it receives a parent span.

### gen_ai author names

- When a user message has an author, the exporter puts it in `name`.
- `name` is the participant field on a gen_ai input message.
- If an author is empty or only whitespace, that exporter throws `RangeError`.

### Export

trace promises when and in what order spans are handed to the exporters.

- A recorded span is handed to the exporters when it ends. It does not wait for shutdown.
- Exporters receive spans in the order they ended, not the order they started.
- When there are several exporters, each one receives the same spans in the same order.
- Shutdown finishes only after any in-progress export has finished.

If shutdown fails, `shutdown` rejects.
The rejection value is `TraceShutdownError`.
Its `failures` holds the exporter, the stage and the failure value.

A root span is not exported unless it is closed with `end`.

Environment variables do not change how recording works.

trace passes a sampler and span limits to the SDK.
OpenTelemetry has environment variables that change the sampler and span limits.
They have no effect on trace's recording.

A span that has ended is always handed to the exporters.
To record nothing, pass no exporters.

## Non-goals

These are things trace does not do.

- It does not write `gen_ai.` names to traces.
- `gen_ai.` names are added only just before the exporter that sends to a viewer.
- It does not build a way to hide conversation content.
- It does not build a screen for viewing traces.
- It does not use the OpenTelemetry Collector.
