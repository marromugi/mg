# @mg/trigger

A package for triggers, which decide before a run whether the run should start.

## Features

Deciding splits into three roles by when the decision is made.

| When       | Role       | Question                        | Package |
| ---------- | ---------- | ------------------------------- | ------- |
| Before run | Trigger    | Should the run start?           | trigger |
| During run | Gate       | May this action be carried out? | gate    |
| After run  | Evaluation | Was the result correct?         | eval    |

A gate asks for permission, and a trigger asks for need.
This package has the trigger type, its error, and a helper that creates the decision span.
It also has a decision implementation that uses an Estimator.

## Usage

You can make a trigger by implementing the decision interface.

```ts
import type { Trigger } from "@mg/trigger";
import { TriggerError, withTriggerSpan } from "@mg/trigger";

type Input = { kind: string; text: string };

const trigger: Trigger<Input> = {
  decide: (input, context) =>
    withTriggerSpan(context, {}, async () => {
      if (input.text.length === 0) {
        throw new TriggerError("Trigger judgement failed");
      }
      return { fired: true, reason: "text is not empty" };
    }),
};

const decision = await trigger.decide({ kind: "issue", text: "hi" });
// decision is { fired: boolean, reason: string }
```

## API

### `withTriggerSpan(context, attributes, body)`

The table lists what you pass to the span helper.

| Name         | Contents                                                               |
| ------------ | ---------------------------------------------------------------------- |
| `context`    | The context received from the caller (nothing is recorded if left out) |
| `attributes` | Extra attributes written to the span                                   |
| `body`       | The decision itself. It receives the span and returns the decision     |

### `createEstimatorTrigger(options)`

This implementation takes a probability from an Estimator and decides with a threshold.
Build it with `createEstimatorTrigger`.

```ts
import { createEstimatorTrigger } from "@mg/trigger";
import type { Estimator } from "@mg/core";

declare const estimator: Estimator;

const trigger = createEstimatorTrigger({
  estimator,
  question: "Is this input worth acting on?",
});

const decision = await trigger.decide({
  kind: "tweet",
  text: "そういえば明日何かあったっけ",
});
```

The table lists what you pass when building it.

| Name        | Contents                                                   |
| ----------- | ---------------------------------------------------------- |
| `estimator` | The Estimator that returns the probability                 |
| `question`  | The question passed to the Estimator                       |
| `threshold` | The lowest probability that counts as firing (default 0.7) |

Pass a threshold between 0 and 1.
If it is out of range or not a finite number, a `RangeError` is thrown when building.

`question` is required.
An empty string, or one with only whitespace, throws a `RangeError` when building.

The decision passes the input's kind and text to the Estimator.
The text is a `Kind: <kind>` line joined with the input's text.
The question is sent exactly as the `question` you passed, including leading and trailing whitespace.
Nothing is added.

The wording of the question is something you choose to fit your input.
This package has no default question.
An example question chosen by measurement is in `runs/trigger-jev.trigger.ts`.

It fires when the probability is at or above the threshold.
The reason text states the probability and the threshold as they are.

Errors thrown by the Estimator are wrapped in a trigger error and thrown.
Other errors are thrown as they are.

When it receives a parent span, it also writes the model, the probability, and the threshold.
This implementation's span does not record the input's kind or text either.

## How it works

### Separating the type from implementations

A trigger is an interface that takes an input and a context and returns a decision.

The input type is a type parameter set by each trigger.
The interface does not fix the shape of the input.

The context is the abort signal and the trace span that becomes the parent.
Both can be left out.

The decision is a boolean for whether it fired, and a reason string.
When it cannot decide, it throws a dedicated error.
The underlying cause is kept in `cause`.

### Tracing

Each time a trigger decides, it creates a span under the parent.
The parent span is received through the context's `trace`.

Only when it receives a parent span does it write the decision as `mg.trigger`.
Without one, it records nothing and just returns the decision.

If the parent throws when creating the span, it still decides, without recording.
If the decision itself throws, it closes the span with that error and throws the same error again.

The span records whether it fired and the reason.
It does not record the input.
Recording the input is the job of the code that calls the trigger.

## Non-goals

- It has no entry point that starts runs.
