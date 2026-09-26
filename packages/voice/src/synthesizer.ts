import type { AudioChunk } from "./audio.js";

export type SpeechOptions = { signal?: AbortSignal };
export interface SpeechSynthesizer {
  readonly name?: string;
  // One call per text. Every chunk declares its own format.
  synthesize(
    text: string,
    options?: SpeechOptions,
  ): AsyncIterable<AudioChunk>;
}
