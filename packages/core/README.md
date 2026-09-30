# @mg/core

A package that collects the shared types and functions for LLM providers and tools.

Harnesses are built by looking only at the types here.
Swapping the provider or the schema library needs no rewrite.

## Features

- Defines the shared type for providers. Also has implementations for OpenRouter and ollama.
- Defines the shared type for model services that answer with probabilities. Also has an implementation for Jev.
- Defines the shared type for runnable tools.
- Has a function that validates and runs one tool call.

## Usage

Create a provider and a tool, ask the model, then run the tool calls it returns.

```ts
import {
  createOpenRouterProvider,
  defineTool,
  runToolCall,
} from "@mg/core";
import { z } from "zod";

const provider = createOpenRouterProvider({ apiKey });

const echo = defineTool({
  name: "echo",
  description: "Returns the text as is.",
  input: z.object({ text: z.string() }),
  async reach() {
    return { kind: "none" };
  },
  async execute({ text }) {
    return text;
  },
});

const response = await provider.generate({
  model: "openai/gpt-4o-mini",
  messages: [{ role: "user", content: "Say hi with echo." }],
  tools: [echo],
});

for (const part of response.parts) {
  if (part.type === "tool-call") {
    // A tool message that carries the tool's result
    const message = await runToolCall([echo], part);
  }
}
```

## API

### Errors

Errors fall into 3 families.

- Provider failures.
- Estimator failures.
- Tool run failures.

The names in each family are listed below.

```
Provider errors
  ProviderBaseError       parent (cannot be created directly)
  ProviderHttpError       a failure response came back
  ProviderTransportError  the connection itself failed
  ToolArgumentsError      the call's arguments cannot be read
  ToolSchemaError         the schema cannot be converted
  ProviderError           union of the 4
  isProviderError         type guard

Estimator errors
  EstimatorBaseError            parent (cannot be created directly)
  EstimatorRequestError         the request got no answer
  EstimatorResponseError        the response is not JSON, has the wrong shape,
                                the chosen label is not one of the given
                                labels, or a probability is out of range
  EstimatorRetryExhaustedError  the retries ran out
  EstimatorError                union of the 3
  isEstimatorError              type guard

Tool run errors
  ToolRunBaseError        parent (cannot be created directly)
  ToolNotFoundError       no tool has that name
  ToolInputError          the arguments failed validation
  ToolRunError            union of the 2
  isToolRunError          type guard
```

Wrapping follows these rules.

- Provider and Estimator errors keep the original exception inside.
- An Estimator error built from another error ends its message with the
  text of the chain below it, joined with `: `. The walk stops at an
  Estimator error, whose message is already complete. An empty message
  adds nothing, and a cause that is not an `Error` or a string reads
  `(non-Error cause)`.
- Every Estimator error also carries `messageWithoutServiceText`, the
  same reason with the service's body text replaced by
  `(text from the service left out)` (`SERVICE_TEXT_LEFT_OUT`). The
  implementation marks body text with one of two options.
  `withoutServiceText` gives the error's own words a second time
  without the body text. `causeQuotesService: true` says the cause's
  text quotes the body, so the whole chain is replaced by the marker.
  With neither mark the second text follows the same walk as the
  message, and an Estimator error in the chain gives its own second
  text.
- A stop caused by an abort passes through unwrapped.
- An exception thrown by a tool's run function also passes through as is.

The Estimator's `EstimatorRequestError` and `EstimatorResponseError`
have `retryable`, which says whether a retry is possible, and `retryAfterMs`, the time to wait in milliseconds.
`retryAfterMs` is optional.

- The Jev implementation treats connection failures and 429 and 5xx
  responses as retryable failures.
- If the response's Retry-After reads as a number of seconds or as an HTTP
  date, it is written to `retryAfterMs`. If not, it is left out.
- For a failure response the Jev implementation throws
  `EstimatorRequestError` with a `JevHttpError` as its cause. The
  `JevHttpError` holds the `status` and the whole `body`. Its message is
  the first 200 characters of the body.
- `EstimatorRetryExhaustedError` says the retries ran out.
  It holds the number of attempts and the last error as its cause. Its
  message ends with the last error's message. It is not retryable.

## How it works

### Providers

A provider handles only one turn with an LLM.
It can answer in 2 ways: all at once, or streaming.
Streaming returns events, such as pieces of text, in order.

Talking to OpenRouter stays inside that implementation.
The API key is taken when the provider is created.

Talking to ollama is a separate implementation.
ollama does not check API keys, so it takes no API key.

The URL to connect to can be left out.
When it is left out, it points at ollama running locally.

These settings can also be passed when the provider is created.

- The context length the model can read.
- Whether to use the thinking behaviour.
- How long to keep the model in memory.

A request to a provider can carry a stop signal.

When the signal fires, the provider stops reading the response.
Streaming keeps the events it has already sent.
Then it sends only one more event, with the finish reason `halted`.
The all-at-once call returns an empty reply with the finish reason `halted`.

Stopping is not treated as an exception.
The signal is optional.
Abort errors not related to the signal are thrown as is.

A user message can carry an author.
The author is a non-empty string that points at a participant.
When it is left out, it means the author is unknown.

Neither the OpenRouter nor the ollama implementation sends the author to the
LLM.
Adding an author leaves the request the same as without one.

A tool call can have a carry.
The carry holds what one provider needs back about that call.
It has the provider's name and its data, and other providers ignore it.
The tool call itself stays free of vendor data.
The streaming tool-call event can hold the same carry,
and the parts built from a stream keep it.

A response, and the finish event of a stream, can list omissions.
An omission says what the provider could not give back faithfully.
The only kind today is `outside-tool-call-id`.
It names the tool calls whose outside id was not sent back.

### Estimator

A type for model services that take a subject and a question and return a
typed judgment.
Its name is Estimator.

The subject is text or a structured value.
A structured value is either one with named fields or a list.
Its contents are text, numbers, booleans, null, and nestings of these.

It is a different kind from providers, which return conversation.
They share no types and no errors.

It is created from these.

- A key.
- A model name.
- The URL to connect to.
- Extra headers.
- A fetch function to swap in.

The defaults for the model name and the URL live inside the Jev
implementation.

An abort signal can be passed when asking.
When aborted, the abort error is thrown as is.
Other failures come back as 3 dedicated errors.

`createRetryingEstimator` is a retry implementation that takes an Estimator
and returns an Estimator. It leaves each call to the given Estimator, and for
retryable failures only, it waits and then calls again.

The caller passes these as arguments. There are no defaults.

- The upper limit on the number of calls.
- How to wait before each retry. If the error has no wait time, it waits in
  this order.
- The upper limit on the wait time. When the error's wait time is over this,
  it does not wait and treats the retries as used up.
- The wait function. When left out, it waits real time.

If the arguments are wrong, it refuses at creation by throwing `RangeError`.

#### Classify

The classify operation takes a subject, a question, and a description for
each label.
The descriptions are passed as a map keyed by label.
One or more labels is enough.

The judgment it returns is the chosen label and a probability for each label.
Every probability is a finite number from 0 to 1.
The confidence that Jev returns is not copied over.

#### Score

The score operation takes a subject, a question, and a description for each
level.
The descriptions are passed as an array.
Two or more levels is enough.
A level's position is its index in this array.

The judgment it returns is a score and a probability for each level.
The score is a number from 0 to the number of levels minus 1.
It can also take values between levels.
The per-level probabilities are an array in the same order as the given
array.
The confidence and legend that Jev returns are not copied over.

#### Declared limits

An Estimator declares its limits as a value.
The limits are the number of labels and the number of levels.
The limits differ by implementation.
The Jev implementation declares 255 for labels and 10 for levels.

When a request has no labels at all, it is refused before any network call.
It is refused the same way when it goes over a limit.
The refusal is a RangeError.
This check runs right after the abort signal is checked.

### Runnable tools

A runnable tool is the tool shape shown to the LLM plus a run function.
It can be passed as is, unchanged, in a request to a provider.

The argument schema has a condition.
It must support both validation and conversion to JSON Schema.

Settings like the working directory and the time limit are passed when the
tool is created.

### Reach

A tool declares what a call touches as a `reach`.
It has one of four kinds.

- `paths` is a list of local paths.
  Each entry has an extent of `file` (that path only) or `tree` (everything under it).
- `any-local` could touch anywhere locally.
- `outside` touches no local path.
- `none` touches nothing.

Each `paths` entry names an absolute path with links followed.

### Run function

The run function takes a list of tools and a call request.
It finds the tool by name, validates the arguments, then runs it.
The result comes back as a message carrying the tool's result.

### Layout

The source is split into 3 folders.

```
src/
├── estimators/ types, errors and the Jev implementation for model services that answer with probabilities
├── providers/  provider types, errors, and the OpenRouter and ollama implementations
└── tools/      runnable tool types, the run function, and its errors
```

The main names are listed by folder.

```
estimators/
  Estimator                shared type for model services that answer with probabilities, classes and levels
  ClassifyRequest          type of a classify request
  Classification           type of a classify judgment
  ScoreRequest             type of a score request
  Score                    type of a score judgment
  EstimatorLimits          type of the limits on the number of labels and levels
  assertClassifyRequest    checks that a classify request fits within the limits
  assertScoreRequest       checks that a score request fits within the limits
  createJevEstimator       creates an Estimator that talks to Jev
  createRetryingEstimator  creates an Estimator that retries

providers/
  Provider                  shared type for providers
  createOpenRouterProvider  creates the OpenRouter provider
  createOllamaProvider      creates the ollama provider
  readSseData               reads a streaming response

tools/
  Tool, defineTool          type of runnable tools, and a helper for defining them
  ToolInput, ToolInputIssue type of validated input, and type of one issue
  validateToolInput         validates input against the schema
  runToolCall               validates and runs one call
```

## Non-goals

These are left to code outside core.

- It has no tool implementations. Built-in tools live in tools.
- It does not repeat tool calls. That is the harness's job.
- It contains no code that depends on the environment, such as child
  processes or environment variables.
- It does not depend on a schema library. The caller brings one in.
- Providers do not validate arguments against the schema. The run function
  does.
