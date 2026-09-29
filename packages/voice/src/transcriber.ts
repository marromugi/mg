import type { AudioChunk, AudioFormat } from "./audio.js";

export type TranscriptEvent =
  // The whole text heard so far; it replaces the previous partial.
  { type: "partial"; text: string } | { type: "final"; text: string };
export type TranscribeOptions = {
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
  // One call per utterance: the audio stream ends when the speaker stops.
  // Ends with exactly one "final" event.
  transcribe(
    audio: AsyncIterable<AudioChunk>,
    options?: TranscribeOptions,
  ): AsyncIterable<TranscriptEvent>;
}
