# @mg/turn

A package for deciding when to do what during a voice conversation.

## Features

There are six judgments. Each takes a situation and returns one action.

| #   | Judgment             | Situation received                                           | Action returned                                   |
| --- | -------------------- | ------------------------------------------------------------ | ------------------------------------------------- |
| ①   | Backchannel          | The transcript so far                                        | A backchannel phrase / do nothing                 |
| ②   | Speech during work   | Tool history, elapsed time                                   | Report the status / a filler phrase / stay silent |
| ③   | Stop                 | What the partner says during the work, the running work      | Stop right away / continue                        |
| ④   | Redirect             | The last few exchanges of speech and reply, the work request | Switch / continue                                 |
| ⑤   | Report the result    | What has been said so far, the work result                   | Speak / defer                                     |
| ⑥   | Overlapping requests | The running work's request, the new request                  | Replace / queue                                   |

Question text, labels, backchannel phrases, and similar wording are passed when you build a judgment.
This package has no default values for that wording.

## Usage

Build a judgment with the question and label descriptions, then pass it a situation.

```ts
import type { Estimator } from "@mg/core";
import { createEstimatorStopJudge } from "@mg/turn";

declare const estimator: Estimator;

const judge = createEstimatorStopJudge({
  estimator,
  question: "Does the user want the work to stop?",
  stop: "The user asks to stop the work.",
  continue: "The user says something else.",
});

const answer = await judge.judge({
  utterance: "Wait, hold on.",
  work: { request: "Fix the typos in README", tools: [] },
});
// answer is { action: "stop" } or { action: "continue" }
```

## API

### `Judge`

Every judgment has the shape of an interface called `Judge`.
Only the situation type and the action type differ between judgments.

A judgment receives a situation and a context.
The context is the abort signal and the trace span that becomes the parent.
Both can be left out.

### Estimator judges

Each of the six judgments has an implementation that answers with an Estimator classification.
Each judgment is built with one function, such as `createEstimatorBackchannelJudge`.

When building one, you pass the question text and a description for each label.
The backchannel and speech-during-work judgments also take a list of phrases.

The judgment passes the situation as it is as the thing to classify, and calls the Estimator's `classify`.
The question and the label descriptions are also sent with the wording as passed.

The label keys are fixed to the action names.

| Judgment             | Keys used                                     |
| -------------------- | --------------------------------------------- |
| Backchannel          | `backchannel-0`, `backchannel-1`, ..., `none` |
| Speech during work   | `report`, `fill-0`, `fill-1`, ..., `silent`   |
| Stop                 | `stop`, `continue`                            |
| Redirect             | `switch`, `continue`                          |
| Report the result    | `speak`, `defer`                              |
| Overlapping requests | `replace`, `queue`                            |

Only the backchannel phrases and the filler phrases can be more than one.
They become numbered keys in the order you pass them.

#### Failures

When the Estimator classification fails, it becomes a `JudgeError`.
The message starts like this.

```
Judgment "<judgment name>" failed
```

The underlying error is kept in `cause`.

When the label the Estimator chose matches none of the actions you passed, it is also a `JudgeError`.
The message states the label the Estimator chose as it is.

When stopped by an abort, the abort error is thrown again as it is.
It is not turned into a `JudgeError`.

When the settings passed at build time cannot be used, a `RangeError` is thrown right away.
This covers an empty question, a phrase passed twice, and more labels than the Estimator's limit.

### Errors

When a judgment cannot be made, it throws `JudgeError`.
`JudgeError` keeps which judgment failed in `judge`.
The underlying error is kept in `cause`.

When stopped by an abort, the abort error is thrown again as it is.

## How it works

### Tracing

Each time a judgment is called, it creates a span named `mg.turn` under the parent.
The parent span is received through the context's `trace`.

Only when it receives a parent span is the judgment recorded.
Without one, it records nothing and just returns the action.

The span records the judgment name and the model name.
Once the answer is decided, it also records the chosen label and the probability of each label.

When a judgment fails, it closes the span with that error.

## Non-goals

- It has no audio input or output.
- It holds no conversation or work state.
- It does not decide which judgment to call when. The caller chooses.
