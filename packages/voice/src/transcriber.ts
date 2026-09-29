import type { AudioChunk, AudioFormat } from "./audio.js";

export type TranscriptEvent =
  // The whole text heard so far; it replaces the previous partial.
  { type: "partial"; text: string } | { type: "final"; text: string };
export type TranscribeOptions = {
  // Once it has fired, the call yields no more events and throws
  // signal.reason unchanged, whatever it is. A failure the call had already
  // reached before it fired is thrown instead. "Fired" is judged when the
  // call is about to yield, end or throw; a wait in progress ends when it fires.
  signal?: AbortSignal;
  // BCP-47 codes of the languages the speech is expected to be in.
  // Omitted: the transcriber works the language out. May be treated as a hint.
  // A code that Intl.getCanonicalLocales rejects fails the call with a RangeError.
  languages?: readonly string[];
};
export interface Transcriber {
  readonly name?: string;
  // Audio in any other format fails the call with a RangeError naming the format.
  readonly accepts: readonly AudioFormat[];
  // One call per utterance: the call reads the end of the audio stream as
  // the end of the utterance. A caller that may end the audio early (for
  // example by stopping the listener) must stop the call through
  // options.signal no later.
  // Ends with exactly one "final" event.
  transcribe(
    audio: AsyncIterable<AudioChunk>,
    options?: TranscribeOptions,
  ): AsyncIterable<TranscriptEvent>;
}
