import type { AudioChunk } from "./audio.js";

export type TranscriptEvent =
  { type: "partial"; text: string } | { type: "final"; text: string };
export type TranscribeOptions = { signal?: AbortSignal };
export interface Transcriber {
  readonly name?: string;
  // One call per utterance: the audio stream ends when the speaker stops.
  // Ends with exactly one "final" event.
  transcribe(
    audio: AsyncIterable<AudioChunk>,
    options?: TranscribeOptions,
  ): AsyncIterable<TranscriptEvent>;
}
