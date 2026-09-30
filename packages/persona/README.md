# @mg/persona

A package of interfaces and types for a persona's recall and reflection.

A persona is one agent that has a personality and keeps living.
The side that runs it looks only at these 2 interfaces and does not know
what is inside the persona.

## Features

- Defines `Persona`, the interface with the recall and reflection
  operations.
- Defines `Extractor`, the interface that decides the candidates for what to
  remember from a conversation.
- Defines the input and output types of the 2 interfaces.
- Has `createRecall`, the recall implementation.
- Has `createRemember`, the reflection implementation.
- Has `createPersona`, which assembles a `Persona` from the recall and
  reflection parts.
- Has `checkExtraction`, a pure function that checks the extractor's
  promise.
- Has `transcribe`, which turns conversation messages into transcript text.
- Has dedicated errors used by recall and the extractor.
- Has `createLlmExtractor`, an implementation that decides with an LLM.

## Usage

Assemble a persona, recall before a turn, then reflect on the turn after it.

```ts
import { createLlmExtractor, createPersona } from "@mg/persona";
import { createMemoryStore } from "@mg/memory";

const store = createMemoryStore();
await store.create("jev", "I am Jev.");

const persona = createPersona({
  id: "jev",
  store,
  estimator,
  recall: {
    question: "...",
    noneDescription: "...",
    ratio: 0.5,
    headings: { about: "...", earlier: "..." },
  },
  extractor: createLlmExtractor({
    provider,
    model: "openai/gpt-4o-mini",
    instruction: "...",
  }),
  keep: { question: "...", threshold: 0.5 },
  persona: { question: "...", threshold: 0.5 },
  forgetting: { missLimit: 3, itemsPerCounterpart: 20 },
});

const { instruction, read } = await persona.recall({
  counterparts: [{ id: "alice", name: "Alice" }],
  conversation: "c1",
  input: "Hello",
});

// Run the turn with instruction, then pass the run's messages
const outcome = await persona.remember({ read, entry: messages });
```

## API

### `Persona`

`Persona<TInput, TRead>` is the interface that represents one persona.
It exposes its id and has 2 operations, recall `recall` and reflection
`remember`.
Neither operation takes the persona's id.

`TInput` is the type of recall's current input.
`TRead` is the type of what was read, which recall returns and reflection
takes.
Their contents are decided outside `Persona`; the interface fixes the shape
of neither.

| Operation  | Takes                                                       | Returns                                      |
| ---------- | ----------------------------------------------------------- | -------------------------------------------- |
| `recall`   | A recall request `RecallRequest<TInput>` and a context      | A recall result `Recall<TRead>`              |
| `remember` | A reflection request `RememberRequest<TRead>` and a context | A reflection result `RememberOutcome<TRead>` |

The context type is `PersonaContext`.
It has an abort signal `signal` and a parent span `trace`, both optional.

`RecallRequest<TInput>` has the list of counterparts `counterparts`, the
conversation id `conversation`, and the current input `input`.
The counterpart type is `Counterpart`, with an id `id` and a display name
`name`.

`Recall<TRead>` has the instruction text `instruction` and what was read
`read`.

`RememberRequest<TRead>` has what was read `read` and the list of messages
in the run's entry `entry`.

### `createRecall(options)`

`createRecall(options)` creates a function that can be used as
`Persona.recall`.
The options have the following.

| Field             | Contents                                                                |
| ----------------- | ----------------------------------------------------------------------- |
| `id`              | This persona's id.                                                      |
| `store`           | A `MemoryStore` from `@mg/memory`.                                      |
| `estimator`       | An `Estimator` from `@mg/core`.                                         |
| `question`        | The question text that asks "which memories relate to this input".      |
| `noneDescription` | The description text for the "none of them relate" label.               |
| `ratio`           | The lower bound of the ratio to the chosen label's probability. 0 to 1. |
| `headings`        | The counterpart heading `about` and the summary heading `earlier`.      |

When a counterpart id, a display name, or the conversation id is empty, or
when counterpart ids are duplicated, it refuses with `RangeError` before
reading.

The part that builds the instruction text is split out into a pure function,
`composeInstruction(read, headings)`.
It returns the instruction text from only what was read, `RecallRead`, and
the headings.

`RecallRead` has the list of counterparts `counterparts`, the conversation
id `conversation`, the personality document `persona`, the summary
`summary` (if any), all items read for each counterpart `items`, the list of
candidate item ids `candidates`, and the list of chosen item ids
`selected`.

### `createRemember(options)`

`createRemember(options)` creates a function that can be used as
`Persona.remember`. The options have the following.

| Field        | Contents                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------ |
| `id`         | This persona's id.                                                                         |
| `store`      | A `MemoryStore` from `@mg/memory`.                                                         |
| `estimator`  | An `Estimator` from `@mg/core`.                                                            |
| `extractor`  | An `Extractor`.                                                                            |
| `keep`       | The keep question `question` and the keep threshold `threshold`.                           |
| `persona`    | The personality question `question` and the personality threshold `threshold`.             |
| `forgetting` | The forgetting limit `missLimit` and the per-counterpart item limit `itemsPerCounterpart`. |
| `now`        | A function that returns the creation time.                                                 |
| `newId`      | A function that returns an item id.                                                        |

The questions, thresholds and limits have no defaults. The caller passes
every value.

When the extractor, the Estimator, `newId` or `now` throws, it returns an
undecided result that holds the thrown value and the request it received,
as is.
Abort errors are returned in the same shape and are not rethrown.
When the store's write throws, it returns a could-not-write result; when the
delete throws, it returns a could-not-forget result. `remember` does not
throw.

### `checkExtraction(extraction, counterparts)`

`checkExtraction(extraction, counterparts)` is a pure function that checks
the extractor's answer, `Extraction`, against the promise.
It judges from only the answer and the list of counterparts, and looks at
nothing else.

It checks that each candidate's counterpart id is in the list, that the
summary, the candidate texts, and the new personality text (only when
returned) are all non-empty, and that no counterpart has the same text
twice. Text that is only whitespace is treated as empty.

If the promise is broken, it returns `ExtractorContractError`.
If it is kept, it returns `undefined`.

### `transcribe(messages)`

`transcribe(messages)` is a function that turns a list of conversation
messages into the transcript text that the extractor and reflection use.

Each message is written one at a time, as a line of the form below followed
by its body.
Paragraphs are separated by one blank line.

| Message             | Line form                                                  |
| ------------------- | ---------------------------------------------------------- |
| system              | `[system]`                                                 |
| user (no author)    | `[user]`                                                   |
| user (with author)  | `[user "<author id>"]`                                     |
| assistant text      | `[assistant]`                                              |
| assistant reasoning | `[reasoning]`                                              |
| assistant tool call | `[tool-call <id> <name>]` (the body is the arguments JSON) |
| tool                | `[tool-result <id>]`                                       |

An assistant message produces one line per part.

If a user message has an author, the id is written as a JSON string, like
`[user "alice"]`. With no author it is `[user]`.

When the author is empty or only whitespace, `transcribe` throws
`RangeError`.
It returns no transcript text.

### `RememberOutcome`

`RememberOutcome<TRead>` is a union of the following 4 shapes.
They are told apart by `updated`, and by `reason` when `updated` is
`false`.

| Shape            | `updated` | `reason`          | Holds                                                                                                                |
| ---------------- | --------- | ----------------- | -------------------------------------------------------------------------------------------------------------------- |
| Updated          | `true`    | none              | ids of added items `added`, whether the personality was rewritten `personaChanged`, ids of deleted items `forgotten` |
| Undecided        | `false`   | `"undecided"`     | the thrown value `error` and the request received, as is, `request`                                                  |
| Could not write  | `false`   | `"write-failed"`  | the thrown value `error`                                                                                             |
| Could not forget | `false`   | `"forget-failed"` | the thrown value `error`, `added`, `personaChanged`, ids of items that could not be deleted `pending`                |

### `createPersona(options)`

`createPersona(options)` assembles one `Persona` from the recall and
reflection parts. The side that runs it looks only at the assembled
`recall` and `remember`.

The options have the following.

| Field        | Contents                                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------------------- |
| `id`         | This persona's id.                                                                                                  |
| `store`      | A `MemoryStore` from `@mg/memory`.                                                                                  |
| `estimator`  | An `Estimator` from `@mg/core`.                                                                                     |
| `recall`     | The recall question `question`, the none description `noneDescription`, the ratio `ratio`, and headings `headings`. |
| `extractor`  | An `Extractor`.                                                                                                     |
| `keep`       | The keep question `question` and the keep threshold `threshold`.                                                    |
| `persona`    | The personality question `question` and the personality threshold `threshold`.                                      |
| `forgetting` | The forgetting limit `missLimit` and the per-counterpart item limit `itemsPerCounterpart`.                          |
| `now`        | A function that returns the creation time. When left out, `Date.now` is used.                                       |
| `newId`      | A function that returns an item id. When left out, nanoid is used.                                                  |

The questions, description, headings, ratio, thresholds and limits have no
defaults.

The assembled persona's `id` is the id passed in, and `recall` and
`remember` hand off to the recall and reflection parts as is.

At assembly time, it throws `RangeError` in these cases.

- The persona id, a question, the description, or a heading is empty.
- The ratio or a threshold is not a finite number from 0 to 1.
- The forgetting limit or the per-counterpart item limit is not an integer
  of 1 or more.
- The Estimator's `limits.maxLabels` is not an integer of 2 or more.
- The per-counterpart item limit is greater than `limits.maxLabels` minus 1.

### `Extractor`

`Extractor` is the interface that decides the candidates for what to
remember from a conversation.
It has no version, id or time.

`extract` takes an input `ExtractorInput` and a context, and returns
candidates `Extraction`.

`ExtractorInput` has the list of counterparts `counterparts`, the list of
messages in the current conversation `entry`, and the current memory
`memory`.
`memory` has the personality text `persona`, the list of texts of items read
for each counterpart `items` (counterpart id `counterpart` and text `text`),
and the summary text `summary` (optional).

`Extraction` has the conversation summary's new text `summary`, the list of
candidate memories about counterparts `items` (counterpart id `counterpart`
and text `text`), and the personality document's new text `persona`
(optional).

### `createLlmExtractor(options)`

`createLlmExtractor(options)` builds an `Extractor` with an LLM.
The options have the provider `provider`, the model name `model`, and the
instruction text `instruction`.

The provider must be one that can force a tool call
(`ToolForcingProvider`). The extractor always forces the remember tool,
so passing a provider that cannot force, such as the Ollama provider,
is a type error.

The instruction is required. It is something the caller measures and
chooses, so there is no default.
If the instruction is empty, it throws `RangeError` at build time.

It throws `ExtractorError` in these cases.
An answer that names a counterpart not in the enum is included in failing
argument validation.

| When                                      | `cause`                  |
| ----------------------------------------- | ------------------------ |
| The provider fails                        | The thrown value         |
| `remember` is called 0 times or 2 or more | None (`undefined`)       |
| The arguments fail validation             | The validation result    |
| The answer breaks the promise             | `ExtractorContractError` |

Abort errors are rethrown as is.

### Errors

The table lists the exceptions thrown.

| Exception        | Thrown when                                                       |
| ---------------- | ----------------------------------------------------------------- |
| `RecallError`    | A call to the Estimator fails during recall                       |
| `ExtractorError` | The extractor could only get answers that cannot keep the promise |
| `RangeError`     | `transcribe` receives an author that is empty or only whitespace  |

`RecallError` and `ExtractorError` hold the thrown value in `cause`.
Errors thrown by the store and abort errors (`name` is `AbortError`) are
also thrown as is by the function `createRecall` creates.

`ExtractorContractError` is not thrown.
Reflection uses it when the extractor's answer breaks the promise.
It comes back in `error` of the undecided shape of `RememberOutcome`.

`ExtractorContractError` has a kind `kind` and a detailed description
`detail`.
There are 3 kinds.

- `unknown-counterpart`: a candidate's counterpart id is not in the given
  list
- `empty-text`: the summary, a candidate text, or the new personality text
  (only when returned) is empty. Text that is only whitespace also counts as
  empty.
- `duplicate-item`: the candidates have the same text for the same
  counterpart 2 or more times

Every exception has its own name in `name`.

## How it works

### Recall

The function `createRecall` creates runs in this order.

1. Reads from the store with the counterpart ids and the conversation id.
2. Takes the items read, newest first, up to `estimator.limits.maxLabels`
   minus 1, as candidates.
3. If there are 0 candidates, it does not call the Estimator, and 0 items
   are chosen.
4. If there are 1 or more candidates, it calls the Estimator's `classify`
   once. The subject is the current input, and the labels are the candidate
   texts and `noneDescription`.
5. If the chosen label is `none`, 0 items are chosen. Otherwise it chooses
   the candidates whose probability is at least the chosen label's
   probability times `ratio`.
6. Combines the personality text, each counterpart's heading and chosen
   items, and the summary heading and text into the instruction text.

If the context has a span `trace`, it creates an `mg.recall` span under it.
The attributes are the persona id, the Estimator's model, the number of
candidates, the JSON of the chosen item ids, and the JSON of the probability
for each label (only when the Estimator was called).
Even if a span operation fails, recall's return value does not change.

### Reflection

The function `createRemember` creates runs in this order.

1. Calls the extractor with the list of counterparts, the messages in the
   run's entry, and the current memory (the personality text, the texts of
   all items read for each counterpart, and the summary text). The context
   carries the abort signal and the reflection span.
2. Checks the extractor's answer with `checkExtraction`. If the promise is
   broken, it returns an undecided result with `ExtractorContractError` as
   the reason.
3. For each candidate memory about a counterpart, it calls the Estimator's
   probability with the keep question. It keeps the candidates whose
   probability is at least the keep threshold.
4. If the extractor also returned new personality text, it calls the
   Estimator's probability with the personality question. The subject is
   the current personality text, the new text, and the conversation
   transcript. If the probability is at least the personality threshold, it
   rewrites the personality.
5. For each candidate to keep, it calls `newId` and `now` and makes a new
   item.
6. Writes to the store once. It passes the summary, the personality (only
   when rewriting), the items to add, the ids of chosen items, and the ids
   of candidate items that were not chosen.
7. Decides which items to delete: items whose count returned by the write
   is at or over the forgetting limit, and, for each counterpart with items
   sorted newest first, the items past the limit. If there are 1 or more,
   it calls delete once.

The function `createRemember` creates calls only the store's `write` and
`delete`. It does not call `read`, and uses only what was read,
`RecallRead`.

If the context has a span `trace`, it creates an `mg.reflection` span under
it. The attributes are the persona id, the Estimator's model, the number of
candidate memories about counterparts, the number kept, whether the
personality was rewritten, and the JSON of the deleted item ids.
The extractor is given the span in this context.
When a failure result is returned, the span is closed with that thrown
value.
Even if a span operation fails, reflection's return value does not change.

### The LLM extractor

The built `extract` calls the provider's `generate` only once per call.
Before calling, it checks the context's signal.
If already aborted, it refuses with that reason and does not call the
provider.

The system message joins a fixed framing text and the given instruction
with a blank line between them. Only this implementation holds the framing
text.

The user message lists the following paragraphs, separated by blank lines.
Only this implementation holds the heading wording too.

1. A `Counterparts:` line, and a `- <id> (<display name>)` line for each
   counterpart.
2. A `## Persona` line and the personality text.
3. For each counterpart, a `## About <id> (<display name>)` line and the
   texts of the items read, one per line after `- `. A counterpart with no
   items gets `(none)`.
4. A `## Summary` line and the summary text. If there is none, `(none)`.
5. A `## Conversation` line and the transcript made by `transcribe`.

The shape of the answer is fixed by forcing a call to `remember`, a tool
dedicated to writing memory. The arguments are the summary `summary`, the
list of candidate memories about counterparts `items`, and the personality
document's new text `persona` (optional).
The arguments are returned as is as the candidates.

The counterpart field `counterpart` in `items` is an enum that allows only
the ids in that call's list of counterparts. The enum is built for each
call from the given list of counterparts.
In a call with no counterparts, `items` can only be written empty.

If the context has a span `trace`, the provider is wrapped in a wrapper that
records it as `mg.llm` under that span.

## Non-goals

- It does not save a persona's memory. The storage interface belongs to
  `@mg/memory`.
