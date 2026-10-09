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
- Defines the microphone interface `Microphone`.
- Holds `createOpenAiSynthesizer`, a synthesizer for any server that takes OpenAI's speech requests.
- Holds `createIrodoriSynthesizer`, a synthesizer for an Irodori-TTS server, which takes OpenAI's speech requests and adds options of its own.
- Holds `createGeminiTranscriber`, a transcriber built on Gemini's Live API.
- Holds `createFfmpegPlayer`, a player that plays through ffmpeg's AudioToolbox output.
- Holds `createFfmpegKeyListener`, a listener that records the microphone through ffmpeg, one utterance per pair of key presses.
- Holds `createFfmpegMicrophone`, a microphone that reads the input device through ffmpeg.
- Holds `createLevelListener`, a listener that cuts a microphone's stream into utterances by loudness.
- Holds `createHalfDuplex`, which joins a microphone and a player so that the microphone hears nothing while the player is sounding.
- Holds `createRecordedListener`, a listener that yields recorded utterances at given times.
- Holds `createRecordingPlayer`, a player that writes each sentence to a WAV file.
- Defines `Clock`, the time source both of them wait on.
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

Once `options.signal` has fired, the call yields no more chunks and throws `signal.reason` unchanged.
A failure the call had already reached before that is thrown instead.

### `Transcriber`

An interface that makes text from spoken audio.

| Type          | Takes                   | Returns                          |
| ------------- | ----------------------- | -------------------------------- |
| `Transcriber` | Stream of speech chunks | Stream of partial and final text |

`transcribe(audio, options)` is called once per utterance.
The call reads the end of the audio stream as the end of the utterance.
A caller that may end the audio early, for example by stopping the listener, must stop the call through `options.signal` no later.
Once `options.signal` has fired, the call yields no more events and throws `signal.reason` unchanged.
A failure the call had already reached before that is thrown instead.
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
It ends earlier, cut, when listening is stopped through the signal.

Once the signal has fired, the stream and the audio of every utterance yield nothing more and end without error.
A failure the listener had already reached before that is thrown by the stream instead.

When the stream ends, the listener is finished.
When it throws, the listener has failed.

### `Microphone`

An interface that gives one continuous stream of audio.

| Type         | Takes        | Returns          |
| ------------ | ------------ | ---------------- |
| `Microphone` | Abort signal | Stream of chunks |

`open(signal)` streams audio chunks from the moment it is opened.
Once the signal has fired, the stream ends without error.
A failure of the microphone is thrown by the stream.

### `createHalfDuplex`

Takes a microphone, a player and `tailMs`, and returns a microphone and a player to use in their place.
`now` is the time source in ms and defaults to `Date.now`.
The returned player forwards `play` and `stop` and counts the plays that are sounding.
A play sounds from the first chunk of its audio that reaches the given player until it returns or throws.
A play whose audio never yields starts no tail.
A chunk of the returned microphone that arrives while a play sounds, or less than `tailMs` after the last one ended, keeps its length and format and carries zeros.
Other chunks pass through unchanged.
Failures of the microphone and of the player pass through unchanged.

### `Player`

An interface that plays audio one sentence at a time.

| Type     | Takes                                | Returns             |
| -------- | ------------------------------------ | ------------------- |
| `Player` | Sentence number and stream of chunks | Whether it finished |

`play(index, audio)` plays one sentence at a time.
When it plays to the end, it resolves with `{ played: true }`.
When stopped partway, it resolves with `{ played: false }`.

`index` is the sentence's position among the sentences of one text that the caller plays, counted from 0.
A sentence the caller does not play takes no index.

- Index 0 begins a new text.
  It comes only when no sentence of an earlier text is still playing or waiting.
- `stop()` ends the text it cut at once, so index 0 may follow it.
- Within a text, the indices come in call order, each one more than the previous call's.
  A sentence starts only after the one before it has ended.

`play` rejects, saying which rule it broke, when the index breaks these rules.
That is index 0 while an earlier text is playing or waiting, an index above 0 with no text begun, or an index that repeats or skips.
It rejects, with the reason, when it cannot play the audio as given.
Each implementation names what it cannot play.
Otherwise it rejects only when the device fails, with the thrown value.

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
- A tone. It can be omitted.
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

The checked Gemini speech synthesis API has no field for a tone either.
A tone put in front of the text is read aloud as part of it.
Passing a tone gives an error at creation time, without any request.

The checked Gemini speech synthesis API has no field for speaking rate.
Passing one gives an error at creation time, without any request.

When the response's finish reason is `STOP`, the audio in that event becomes a chunk.
Reading stops there and synthesis ends.
Even if that event has parts other than audio, such as text, they are not streamed.
If no audio arrived before `STOP`, it fails.

When the finish reason is anything other than `STOP`, the audio in that event becomes a chunk.
After that, it fails with that reason.
It fails whether or not there was audio.

Once the abort signal has fired, the call yields no more audio, even audio it has already read.
It throws the signal's reason, unchanged, whatever the reason is.
A signal that has fired before the call sends no request.
A call waiting for the response, or for its body, ends as soon as the signal fires.
A failure met after the signal fired is thrown as the reason.

The one exception is an HTTP failure status received before the signal fired.
If the signal fires while its body is being read, the call throws `GeminiSpeechHttpError` with that status and an empty body.
The message is `Gemini speech request failed: <status> (body not read: the call was stopped)`.

An `AbortError` met while the signal has not fired is thrown as is.
This covers the replacement request function, the reading of a failure body, and the response stream.
Other failures come back as 3 dedicated error types.

### OpenAI speech synthesis

One implementation of `SpeechSynthesizer`.
It speaks OpenAI's speech API, so it works with any server that follows that API, such as an Irodori-TTS server.

It is created from the following.

- A server address, up to and including `/v1`. It cannot be omitted.
- A model name. It cannot be omitted.
- A voice name. It cannot be omitted.
- A tone. It can be omitted.
- A key. It can be omitted.
- Extra headers.
- A replacement request function.

`synthesize(text, options)` sends `POST <address>/audio/speech` with the JSON `{ model, input, voice, response_format: "wav" }`.
The `Authorization: Bearer <key>` header is sent only when a key is given.

When a tone is given, the JSON also holds `instructions: <tone>`, and every text is read in that tone.
Without a tone, the field is left out.
A server that ignores the field reads without the tone, as an Irodori-TTS server does; use the Irodori synthesizer for it.
Passing an empty or whitespace-only string gives `RangeError` at creation time, without any request.

The response is read as WAV.
Its sample rate and channel count become the format of every chunk.
The sample data streams as chunks while the body arrives, and each chunk holds whole samples.
A data length of 0 or 0xFFFFFFFF in the header means the data runs to the end of the body.
Only 16-bit PCM WAV is accepted.

| What happened                                   | What the call throws                                                                     |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------- |
| The server answers with a failure status        | `OpenAiSpeechHttpError`, with the status, the body, and the server's message in the text |
| The request cannot be sent, or the body breaks  | `OpenAiSpeechTransportError`, with the cause                                             |
| The body is not 16-bit PCM WAV, or has no audio | `OpenAiSpeechResponseError`, naming what was received                                    |

`isOpenAiSpeechError` tells them apart.
The abort signal behaves as described for `SpeechOptions`.
If it fires while the body of a failure status is being read, the call throws `OpenAiSpeechHttpError` with that status and an empty body.

To try it by hand, run the sample entry.
It speaks one text, prints the format and the byte count, and writes a WAV file.

```
SPEECH_BASE_URL=http://127.0.0.1:8088/v1 SPEECH_MODEL=irodori-tts SPEECH_VOICE=none \
  node runs/openai-tts.ts "<text>" ["<tone>"]
```

### Irodori speech synthesis

One implementation of `SpeechSynthesizer`.
It speaks to an Irodori-TTS server, which takes OpenAI's speech requests and adds options of its own.
It sends and reads the same way as the OpenAI speech synthesis.

It is created from the following.

- A server address, up to and including `/v1`. It cannot be omitted.
- A voice name. It cannot be omitted.
- A tone. It can be omitted.
- A model name. It can be omitted. The default is `irodori-tts`.
- A key. It can be omitted.
- Extra headers.
- A replacement request function.

When a tone is given, the JSON also holds `irodori: { caption: <tone> }`, and every text is read in that tone.
Without a tone, the field is left out.
Passing an empty or whitespace-only string gives `RangeError` at creation time, without any request.

To try it by hand, run the sample entry.
It speaks one text, prints the format, the byte count, and the duration in seconds, and writes a WAV file.

```
SPEECH_BASE_URL=http://127.0.0.1:8088/v1 SPEECH_VOICE=none \
  node runs/irodori-tts.ts "<text>" ["<tone>"]
```

### Gemini transcription

One implementation of `Transcriber`.
It streams each utterance to its own Gemini Live session while the audio arrives.

It is created from the following.

- A key.
- A model name. It can be omitted.
- A server URL. It can be omitted.
- A replacement WebSocket constructor. It can be omitted.
- How long to wait for the completion after the audio ends, in milliseconds. It can be omitted, and then it is 3000.

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
A signal that has already fired is checked before the language codes.
When it is left out, no hint is sent and Gemini detects the language.

After the abort signal has fired, the call drops what it had received but not yet yielded, including a final, and throws the signal's reason.
An error it had received before the signal fired is thrown as that error.

Failures end the call and close the session.

| Cause                                              | Failure                                                             |
| -------------------------------------------------- | ------------------------------------------------------------------- |
| A language code that is not a well-formed tag      | `RangeError`, before any connection                                 |
| A chunk in another format, or a format change      | `RangeError` that names the format                                  |
| The connection fails, or the session closes early  | `GeminiTranscriptionTransportError`, with the close code and reason |
| A message that is not valid JSON                   | `GeminiTranscriptionResponseError`                                  |
| A second completed transcription                   | `GeminiTranscriptionResponseError`                                  |
| No completion within the wait after the audio ends | `GeminiTranscriptionResponseError`                                  |
| The abort signal fires                             | The signal's reason, unchanged                                      |
| The audio stream throws                            | That error, unchanged                                               |

The transcription errors do not share a base class with the speech synthesis errors.
`isGeminiTranscriptionError` tells them apart.
Gemini may never complete on audio with no speech.
The wait starts when the end of the audio has been sent, and it is cleared when the call ends for any reason.
When it runs out, the call throws the error with the message `Gemini did not complete the transcription within <wait> ms after the audio ended`.
Partials already yielded are not turned into a final.
Before the audio ends, the abort signal is the only limit on waiting.
An abort still wins and shows as described above.

To try it by hand on a WAV file, run the sample entry.
It feeds the audio in 100 ms chunks at real-time pace.
It prints each partial, the final text, and the time from the last chunk to the final.

```
node --env-file-if-exists=.env runs/gemini-stt.ts "<wav>" [language...]
```

### ffmpeg playback

One implementation of `Player`.
It plays each sentence through ffmpeg's AudioToolbox output.

It is created from the function that starts a process.
The function takes a command and its arguments.
It returns the process's stdin, its output, a promise of its exit, and a way to kill it.
The exit is the exit code, or the name of the signal that ended the process.
The output ends when the process closes it and never throws.
The description of a started process lives in `ffmpeg/process.ts`.
The ffmpeg command line lives only inside this implementation.

`play(index, audio)` starts one ffmpeg process for the sentence.
The process reads raw 16-bit little-endian samples at the first chunk's rate and channel count.
Every chunk's bytes are written to its stdin, which is closed when the audio ends.
The index rules are those of `Player`.

| Situation                           | `play`                                  |
| ----------------------------------- | --------------------------------------- |
| The process exits with code 0       | Resolves `{ played: true }`             |
| `stop()` is called                  | Resolves `{ played: false }`            |
| The process exits with another code | Rejects with the exit code              |
| A signal ends the process           | Rejects naming the signal               |
| The process cannot start            | Rejects with the start error            |
| A chunk's rate or channels differ   | Rejects naming both formats, kills it   |
| A chunk is not `pcm-s16le`          | Rejects naming the encoding, kills it   |
| It exits 0 before all audio is sent | Rejects with that reason                |
| The audio has no chunks             | Resolves `{ played: true }`, no process |

`stop()` kills the running process and resolves every waiting `play` as not played.
It never throws.

To hear it, run the sample entry.
It plays a one-second 440 Hz tone and prints `played: true`.

```
node runs/ffmpeg-player.ts
```

### ffmpeg key listener

One implementation of `Listener`.
It records the microphone through ffmpeg's AVFoundation input.
An utterance starts and ends on a key press, since detecting speech by loudness would pick up the player's own voice.

It is created from the following.

- The function that starts a process, described in `ffmpeg/process.ts`.
- The key presses, as a stream. It does not read the terminal itself.
- Optionally, the microphone's name as macOS shows it. ffmpeg matches the name, so a leading part of it works too. Without a name, the system's default input is used.
- The audio format to produce.

A key press yields one utterance and starts one ffmpeg process.
The process writes raw 16-bit little-endian audio at the format's rate and channel count.
The utterance's audio carries the process's output as chunks in that format.
The next key press kills the process and ends the audio.
No conversion is made.
The ffmpeg command line lives only inside this implementation.

Aborting stops the process and ends the audio and the listening without error.

| Situation                                  | Audio and listening         |
| ------------------------------------------ | --------------------------- |
| The process exits with a non-zero code     | Throws with the exit code   |
| A signal the listener did not send ends it | Throws naming the signal    |
| The process cannot start                   | Throws with the start error |
| The listener's own kill ends it            | Ends, nothing thrown        |

To try it, run the sample entry.
It presses a key, waits 2 seconds, presses again, and prints the chunk count and the format.
The terminal needs microphone permission.

```
node runs/ffmpeg-listener.ts [microphone]
```

### ffmpeg microphone

One implementation of `Microphone`.
It reads the input device through ffmpeg's AVFoundation input, and uses the same ffmpeg command line and exit handling as the key listener.

It is created from the function that starts a process, the audio format to produce, and optionally the microphone's name as macOS shows it.
Without a name, the system's default input is used.

Opening starts one ffmpeg process.
The signal firing kills it and ends the stream without error.

| Situation                                    | Stream                      |
| -------------------------------------------- | --------------------------- |
| The process exits with a non-zero code       | Throws with the exit code   |
| A signal the microphone did not send ends it | Throws naming the signal    |
| The process cannot start                     | Throws with the start error |

### Level listener

One implementation of `Listener`.
It reads a `Microphone` and sends on only the stretches where the sound is above a level.
It knows nothing about ffmpeg.

It is created from the following.

- The microphone.
- `levelDb`: the level, in dB relative to full scale.
- `startMs`: how long the sound must stay at or above the level to start an utterance.
- `endMs`: how long it must stay below the level to end one.
- `leadMs`: how much of the audio before the start is kept in the utterance.

The loudness is the RMS of each 20 ms window of audio, counted in samples, so the size of the microphone's chunks does not matter.
An utterance carries the `leadMs` before the first loud window, then everything up to its end, including the `endMs` of quiet that ended it.
Nothing is yielded while it is quiet.
An utterance still open when the microphone's stream ends, or the signal fires, ends there.
A failure of the microphone is thrown by the stream, and by the audio of an utterance open at that time.

To see the cutting without speaking, run the sample entry on a 16-bit PCM WAV file.
It prints one line per utterance with its start and length, then the count.

```
node runs/level-listener.ts "<wav>" [level]
```

### Recorded listener and recording player

Two implementations that let a dialogue run without a person.
Both take a `Clock` from outside: `now()` and `sleep(ms, signal)`.
`sleep` rejects when the signal aborts.

`createRecordedListener({ utterances, clock })` is a `Listener`.
Each utterance has a start time `at` in milliseconds and its audio as chunks.

- It yields each utterance at `at`, measured from the start of listening, in the order given.
- The audio of an utterance yields each chunk, waits the chunk's duration, then goes on.
- The audio ends after the last chunk's duration.
- Once the signal has fired, the stream and every audio end without error.

`createRecordingPlayer({ write, clock })` is a `Player`.
`write(name, bytes)` receives each sentence as a WAV file.
The index rules are those of `Player`.

- Sentence `n` of text `t` is written as `<t>-<n>.wav`, both counted from 0.
  Each index 0 begins the next text number.
- The file is a 16-bit PCM WAV in the format of the sentence's chunks.
- `play` waits until each chunk's end, measured from the start of the audio, and resolves `{ played: true }` after the audio's duration.
- `stop()` resolves the running and every waiting `play` as not played.
  The stopped sentence's file holds the chunks whose full duration had passed before the stop.
  A sentence that never started writes no file.
- A chunk whose encoding, rate or channels differ from the first chunk's rejects the play, naming both formats.
  The file holds the chunks whose full duration had passed before it.
  If that write fails too, the rejection stays the format error and carries the write error as its cause.
- A chunk that is not `pcm-s16le` rejects the play, naming the encoding.
- A play rejected before it takes a chunk writes no file.
- A failed `write` rejects the play with the writer's error.

## Non-goals

- It does not open the device's microphone or speakers itself.
  The ffmpeg player and listener use them by way of a process that is passed in.
- It does not put together voice conversations.
- It does not decide whether something may run.
- It does not decide when to speak.
- It does not depend on any other package in this repository.
