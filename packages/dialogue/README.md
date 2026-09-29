# @mg/dialogue

A package for carrying a spoken conversation between a person, a talker and a worker.

It holds the session function `runDialogue`, the interfaces the session is built against, and the talker's error.

## Features

- Defines the talker interface `Talker` and its `TalkerReplyOptions`.
- Defines the worker interface `Worker`, its `WorkRequestOptions` and its `WorkEnding`.
- Defines `WorkTriggerInput`, the input of the work trigger.
- Defines `WorkStatus`, what the worker is doing.
- Defines `DialogueWording`, the wording the session is given.
- Defines `DialogueOptions`, `DialogueContext` and `DialogueEvent`.
- Defines `RunDialogue`, the type of the session function.
- Holds `runDialogue`, the session: one cycle per utterance, deciding every handoff between the person, the talker and the worker.
- Holds `TalkerError`, the error a talker rejects with.

## API

### `Talker`

Takes one message and returns the trace session id of its run.
It streams the reply text through `onText`.
`onTextEnd` is called once when the reply text is complete.
It is not called when the run fails, stops at a limit or is wrapped up.
`heard` settles with how many characters the person heard.
It rejects with `TalkerError` when the run fails or is not saved.

### `Worker`

Takes a request and ends with a `WorkEnding`.
It can be held, released and wrapped up.

### `runDialogue`

Runs until the listener ends and the current cycle is done.
It rejects when the listener or the player fails, and with the abort reason when its signal is aborted.
Judgment and part failures do not end it; each shows as a `failure` event.
It speaks replies, reports and notices one text at a time, through the reply speaker.

### `DialogueOptions`

Every collaborator and every piece of wording is passed in by the caller.
This package holds no default values.
