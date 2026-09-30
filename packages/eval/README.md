# @mg/eval

A package with functions that read saved traces back and use them to judge a run.

## Features

- Reads the tree.
  It pulls out the steps in time order, the final reply, and the number of turns.
- Writes the steps out as text.
  The text can be read by both people and an Estimator.
- Defines the type of a check.
  Rules and Estimators are handled in the same shape.
- Runs an array of checks, all of them, in the order written.
  It returns whether the case passed and the result of each check.

## Usage

This example judges one session run by `runner` with both a rule and an Estimator.

```ts
import { createJevEstimator } from "@mg/core";
import { createEstimatorChecker, evaluate, rule } from "@mg/eval";
import { JsonlTraceReader } from "@mg/trace/store";

const estimatorCheck = createEstimatorChecker({
  estimator: createJevEstimator({
    apiKey: process.env.TYPESAFE_API_KEY!,
  }),
});

const checks = [
  rule("has-final-text", (view) => view.finalText !== undefined),
  estimatorCheck({
    name: "answers-with-listing",
    question:
      "Does the final assistant reply report the actual output of ls?",
    threshold: 0.9,
  }),
];

const session = await new JsonlTraceReader("./trace.jsonl").readSession(
  sessionId,
);
const verdict = await evaluate(session, checks);

verdict.passed; // true only when both the rule and the Estimator pass
```

A complete example that runs several cases with `runMany` and judges each
one is in `runs/eval-example.ts`.

## API

### Reading the tree into a run view

`viewRun` takes the `SessionTree` returned by `@mg/trace/store`.
It returns a `RunView`.

```ts
import { viewRun } from "@mg/eval";

const view = viewRun(sessionTree);

view.steps; // llm / tool / gate / subagent steps in time order
view.turnCount; // number of harness turns
view.finalText; // text of the final reply
view.usage; // total token usage
```

If no run is found in the tree, it throws `NoRunInSessionError`.

### The check interface

A check is handled with a single type, `Check`.
Checks decided by rules and checks that ask an Estimator have the same shape.

A `Check` holds only a name and a function that does the check.
The function receives the trace tree and the run view.
It returns whether it passed and why.

```ts
import type { Check } from "@mg/eval";

const myCheck: Check = {
  name: "no-secrets-in-output",
  async evaluate({ session, view }) {
    const ok = !view.finalText?.includes("SECRET");
    return {
      passed: ok,
      reason: ok ? "no problem" : "contains a secret value",
    };
  },
};
```

`evaluate` takes the trace tree and an array of checks.
It runs every check in the array, in the order written.
If one check fails, the rest still run.

The run view (`RunView`) is read only once.
Every check receives the same one.

```ts
import { evaluate } from "@mg/eval";

const verdict = await evaluate(session, [checkA, checkB]);

verdict.passed; // true only when every check passed
verdict.checks; // result of each check, in the same order as the array
```

The result of each check is in one of the three states below.

| State    | Meaning                        |
| -------- | ------------------------------ |
| `passed` | The check passed               |
| `failed` | The check did not pass         |
| `error`  | The check itself could not run |

A check that could not run is kept apart from one that did not pass.
Not passing means "it did not meet the standard".
An error means "the check could not be run".

A case passes only when every check passed.
If even one check did not pass or had an error, the case does not pass.
If no checks are given, the case is treated as passed.

Only an abort signal (`AbortSignal`) is rethrown as is, without wrapping.
If the signal aborts during a check, `evaluate` also stops there.

### Rules

Conditions that can be checked mechanically are judged with rules.
For example, how many times a tool was called, or what the final reply contains.

`rule` is an interface that builds a `Check` from a name and a function.
The function receives the run view (`RunView`) and returns pass or fail.
It may return just a boolean, or add a reason and details.

```ts
import { rule } from "@mg/eval";

const withinToolLimit = rule("bash-within-3", (view) => {
  return (
    view.toolSteps.filter((step) => step.name === "bash").length <= 3
  );
});

const hasFinalText = rule("has-final-text", (view) => {
  const passed = view.finalText !== undefined;
  return {
    passed,
    reason: passed ? "has a final reply" : "final reply is empty",
  };
});
```

If the rule's name is an empty string, `rule` throws `RangeError`.

An exception thrown by the check itself passes straight through `rule`.
`evaluate` catches that exception and turns it into the `error` state.

The two samples above are for explanation and are not exported by the package.
Ready-made rules, such as a limit on how many times a tool is called, are not
included in this package either.
To use one as a check, write it in your own project.

### Estimator

Conditions that cannot be written mechanically are judged by meaning.
core's `Estimator` takes the thing to judge and a question, and returns the probability that the answer is "yes".

`createEstimatorChecker` builds a check interface from an `Estimator` implementation.

```ts
import { createJevEstimator } from "@mg/core";
import { createEstimatorChecker } from "@mg/eval";

const estimatorCheck = createEstimatorChecker({
  estimator: createJevEstimator({ apiKey: process.env.JEV_API_KEY! }),
});
```

Pass this interface a name, a question and a threshold, and you get a check (`Check`).
The person writing the check decides the question text.

```ts
const isPolite = estimatorCheck({
  name: "polite-reply",
  question: "Is the final reply phrased politely?",
  threshold: 0.9,
});
```

`EstimatorCheckOptions` takes the three fields below.

| Field       | Meaning                                        |
| ----------- | ---------------------------------------------- |
| `name`      | Name of the check.                             |
| `question`  | Text of the question sent to the Estimator.    |
| `threshold` | Pass threshold. Defaults to `0.9` if left out. |

The threshold means the check passes when the probability is that value or higher.
`0.9` sets the standard "passes with a probability of 90% or more".

The check sends the run's transcript and the question to the `Estimator`.
It compares the returned probability with the threshold, and the result keeps both.
The reason text also shows the probability and the threshold.

If the `Estimator` call fails, the error is rewrapped in `EstimatorCheckError`.
Its text is `Estimator request failed: ` followed by the text of the `Estimator` error.
The original error is kept as `cause`.
Only an abort signal (`AbortSignal`) is rethrown as is, without wrapping.

### Transcription

`transcribe` writes a `RunView` out as text that people and an Estimator can read.
By default, the Estimator check uses this function to turn a run into text.

```ts
import { transcribe } from "@mg/eval";

const text = transcribe(view);
```

A long tool result is cut at a character limit.

```ts
transcribe(view, { maxToolResultLength: 500 });
```

A subagent step is one block of the form `[subagent <name>] <result>`.
A long result is cut at the same limit as tool results.

A subagent step that ended in an error takes this form.

```
[subagent <name> error] <error text>
```

The first LLM step's input messages come first, as `[system] ...` and `[user] ...` lines.
If that input cannot be read, the transcript opens with one line holding the reason instead.
The rest of the transcript is the same.

```
[input unreadable] <reason>
```

If a user message has an author, its id is written as a JSON string, as in
`[user "alice"] <body>`. Without an author it is `[user] <body>`.

If the author is empty or only whitespace, `transcribe` throws `RangeError`.
It does not return the transcript text.

To replace the transcription, pass your own to `createEstimatorChecker`.

```ts
const estimatorCheck = createEstimatorChecker({
  estimator: createJevEstimator({ apiKey: process.env.JEV_API_KEY! }),
  transcribe: (view) => view.finalText ?? "",
});
```

### LLM step input

An LLM step's `input` is either the list of messages that was sent or the reason it cannot be read.
System messages are in the list at the positions where they were sent.
The step never holds an empty list in place of an input it could not read.

```ts
const { input } = view.llmSteps[0];
if (input.kind === "messages") {
  input.messages; // Message[]
} else {
  input.reason; // why the record cannot be read
}
```

## How it works

### Reading the trace tree

A trace is saved as a tree of spans. The tree mixes LLM calls,
tool runs and gate checks together.

Walking this tree every time is tedious for the person writing checks.
So the package first provides a function that reads the tree into a run view.

The only input to this reading is the trace tree a reader returns.
It does not take the run's result (`HarnessResult`).

LLM calls under a gate are not counted as harness turns.
Calls made for checking are not steps of the run itself.

### Subagent steps

Subagent calls are recorded as `mg.subagent` spans.

`view.steps` also includes subagent steps, mixed in by time.
They are not in the list of tool steps (`view.toolSteps`).

```ts
view.subagentSteps; // only the subagent steps
```

A subagent step holds the name, the call ID, the arguments and the result.
It also holds the ID of the child conversation's thread, which is created new
for each call.

The child conversation is a separate trace in the same session as the run.
`usage`, the turn count and `finalText` cover only the run's trace.
The child conversation's share is not mixed in.

`viewRun` does not go and read the child conversation's trace.
A subagent step holds only up to the thread ID.

## Non-goals

- It does not hold the content of rule or Estimator checks themselves (ready-made policies).
  The question text and the threshold value are decided by whoever writes the check.
- It does not change the trace vocabulary (`SPAN` and `ATTR`) or `@mg/trace/store`.
- It does not write check results back to the trace.
