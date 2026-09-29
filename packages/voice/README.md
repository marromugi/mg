# @mg/voice

A package of interfaces and types for audio input and output.

It holds audio chunks, speech synthesis, transcription, listeners, players, and sentence splitting.

## Features

- Defines the audio chunk type `AudioChunk`.
- Defines the format type `AudioFormat`.
- Defines the speech synthesis interface `SpeechSynthesizer`.
- Defines the transcription interface `Transcriber`.
- Defines the listener interface `Listener`.
- Defines the player interface `Player`.
- Holds `createGeminiTranscriber`, a transcriber built on Gemini's Live API.
- Holds `splitSentences`, a function that cuts text into sentences to read aloud.

## Usage

Split text into sentences, then turn each sentence into audio.

```ts
import { createGeminiSynthesizer, splitSentences } from "@mg/voice";

const synthesizer = createGeminiSynthesizer({
  apiKey: "your-api-key",
  voice: "Kore",
});

const { sentences } = splitSentences(text, 0, true);

for (const sentence of sentences) {
  for await (const chunk of synthesizer.synthesize(sentence.text)) {
    // chunk.format and chunk.data hold one piece of audio
  }
}
```

## API

### Audio chunks

`AudioFormat` has an encoding, `encoding`.
It also has a sample rate, `sampleRate`.
It also has a channel count, `channels`.
The format is declared by the implementation.

`AudioChunk` has a format, `format`.
It also has the sample data, `data`.

| Type         | Takes   | Returns            |
| ------------ | ------- | ------------------ |
| `AudioChunk` | Nothing | Samples and format |

### `SpeechSynthesizer`

An interface that turns text into a stream of audio chunks.

| Type                | Takes | Returns          |
| ------------------- | ----- | ---------------- |
| `SpeechSynthesizer` | Text  | Stream of chunks |

`synthesize(text, options)` is called once per text.
Each returned chunk carries its own format.

### `Transcriber`

An interface that makes text from spoken audio.

| Type          | Takes                   | Returns                          |
| ------------- | ----------------------- | -------------------------------- |
| `Transcriber` | Stream of speech chunks | Stream of partial and final text |

`transcribe(audio, options)` is called once per utterance.
The audio stream ends when the speaker finishes talking.
It streams some partial text, then one piece of final text.

Each partial holds the whole text heard so far.
It replaces the previous partial instead of adding to it.

`accepts` lists the audio formats the transcriber takes.
Audio in any other format fails the call with a `RangeError` that names the format.
The transcriber does not convert audio.

`options.languages` lists the languages the speech is expected to be in, as BCP-47 codes.
When it is left out, the transcriber works the language out.
An implementation may treat the list as a hint.
A code that is not a well-formed tag fails the call with a `RangeError`.

### `Listener`

An interface that delivers what the other person says.

| Type       | Takes        | Returns              |
| ---------- | ------------ | -------------------- |
| `Listener` | Abort signal | Stream of utterances |

`listen(signal)` streams one `HeardUtterance` each time the other person starts talking.
It is the same whether they start by voice or by push-to-talk.
The audio of a `HeardUtterance` ends when the other person finishes talking.

When the stream ends, the listener is finished.
When it throws, the listener has failed.

### `Player`

An interface that plays audio one sentence at a time.

| Type     | Takes                                | Returns             |
| -------- | ------------------------------------ | ------------------- |
| `Player` | Sentence number and stream of chunks | Whether it finished |

`play(index, audio)` plays one sentence at a time, in order of sentence number.
When it plays to the end, it resolves with `{ played: true }`.
When stopped partway, it resolves with `{ played: false }`.
When the device fails, it rejects with the thrown value.

`stop()` stops the sentence being played right away.
It resolves every waiting `play` as not played.

### `splitSentences`

A pure function that cuts streaming text into sentences to read aloud.
It uses no I/O and no timers.

| Type             | Takes                                            | Returns                               |
| ---------------- | ------------------------------------------------ | ------------------------------------- |
| `splitSentences` | Text, start position, and whether the turn ended | Sentences and the next start position |

`splitSentences(text, from, final)` takes the following.

- `text` is all the text that has arrived so far in the turn.
- `from` is the `next` returned by the previous call.
- In a new turn, `from` is 0.
- `final` is whether the turn has ended.

The returned `sentences` is a list of `{ text, end }`.
`text` is one sentence with leading and trailing whitespace removed.
`end` is where that sentence ends in `text`.

The returned `next` is where to start cutting next.

A sentence ends at "。", "！", "？", "!", "?", or a line break.
"." counts as an end only when whitespace follows it.
A run of end marks counts as one end.
A closing bracket right after the end is included in the same sentence.
End marks inside an open bracket or quotation do not cut a sentence.

A break of only whitespace does not become a sentence.
Even so, `next` moves forward past it.

If an end mark is at the end of the text in the middle of a turn, that sentence is not returned yet.
It is decided after more text arrives.
When `final` is `true`, the remaining text is returned as the last sentence.
In that case `next` becomes `text.length`.

When `from` is not an integer, it throws `RangeError`.
It throws the same when `from` is negative.
It also throws when it is larger than `text.length`.
The message includes both `from` and `text.length`.

Positions are counted the same way as `text.length`.

### Gemini speech synthesis

One implementation of `SpeechSynthesizer`.
It passes text to Gemini speech synthesis and turns it into audio.

It is created from the following.

- A key.
- A voice name. It cannot be omitted.
- A language. It can be omitted.
- A speaking rate. It can be omitted.
- A model name. It can be omitted.
- A server URL. It can be omitted.
- Extra headers.
- A replacement request function.

The defaults for the model name, server, and audio format live only inside this implementation.

`synthesize(text, options)` passes the text in one request.
The audio that comes back streams as chunks in the order it arrives.
Every chunk is signed 16-bit little-endian.
The rate and channel count are the values the response declares.
If no channel count is declared, it is 1.

The language is put as is into the field that the checked API has.
When omitted, the field is not sent and Gemini decides.
Passing an empty string gives `RangeError` at creation time.

The checked Gemini speech synthesis API has no field for speaking rate.
Passing one gives an error at creation time, without any request.

When the response's finish reason is `STOP`, the audio in that event becomes a chunk.
Reading stops there and synthesis ends.
Even if that event has parts other than audio, such as text, they are not streamed.
If no audio arrived before `STOP`, it fails.

When the finish reason is anything other than `STOP`, the audio in that event becomes a chunk.
After that, it fails with that reason.
It fails whether or not there was audio.

An abort signal received during synthesis is thrown as is.
Other failures come back as 3 dedicated error types.

### Gemini transcription

One implementation of `Transcriber`.
It streams each utterance to its own Gemini Live session while the audio arrives.

It is created from the following.

- A key.
- A model name. It can be omitted.
- A server URL. It can be omitted.
- A replacement WebSocket constructor. It can be omitted.

The defaults for the model name and server live only inside this implementation.
The name is `gemini`.
It accepts one format: 16-bit little-endian PCM, 16000 Hz, 1 channel.

`transcribe(audio, options)` opens one session per call.
Gemini's own activity detection is off.
The start of the call marks the start of speech, and the end of the audio stream marks its end.
When the audio stream ends with no chunks, the call yields one empty final and opens no connection.

Each in-progress transcription from Gemini becomes a partial, with its text as is.
The completed transcription is held, not sent as a partial.
When Gemini signals that generation is complete, the call yields one final with the held text, closes the session, and ends.
When no completed transcription came, the final is empty text.

`options.languages` is passed as is to Gemini's language hint for input transcription.
When it is left out, no hint is sent and Gemini detects the language.

Failures end the call and close the session.

| Cause                                             | Failure                                                             |
| ------------------------------------------------- | ------------------------------------------------------------------- |
| A language code that is not a well-formed tag     | `RangeError`, before any connection                                 |
| A chunk in another format, or a format change     | `RangeError` that names the format                                  |
| The connection fails, or the session closes early | `GeminiTranscriptionTransportError`, with the close code and reason |
| A message that is not valid JSON                  | `GeminiTranscriptionResponseError`                                  |
| A second completed transcription                  | `GeminiTranscriptionResponseError`                                  |
| The abort signal fires                            | The signal's reason, unchanged                                      |
| The audio stream throws                           | That error, unchanged                                               |

The transcription errors do not share a base class with the speech synthesis errors.
`isGeminiTranscriptionError` tells them apart.
The call sets no timeout of its own; the abort signal is the only limit on waiting.

To try it by hand on a WAV file, run the sample entry.
It feeds the audio in 100 ms chunks at real-time pace.
It prints each partial, the final text, and the time from the last chunk to the final.

```
node --env-file-if-exists=.env runs/gemini-stt.ts "<wav>" [language...]
```

## Non-goals

- It does not hold the device's microphone or speakers.
- It does not put together voice conversations.
- It does not decide whether something may run.
- It does not decide when to speak.
- It does not depend on any other package in this repository.
