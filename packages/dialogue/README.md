# @mg/dialogue

A package of interfaces for carrying a spoken conversation between a person, a talker and a worker.

It holds types and the talker's error only. The session itself is built against these interfaces.

## Features

- Defines the talker interface `Talker` and its `TalkerReplyOptions`.
- Defines the worker interface `Worker`, its `WorkRequestOptions` and its `WorkEnding`.
- Defines `WorkTriggerInput`, the input of the work trigger.
- Defines `WorkStatus`, what the worker is doing.
- Defines `DialogueWording`, the wording the session is given.
- Defines `DialogueOptions`, `DialogueContext` and `DialogueEvent`.
- Defines `RunDialogue`, the type of the session function.
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

### `DialogueOptions`

Every collaborator and every piece of wording is passed in by the caller.
This package holds no default values.
