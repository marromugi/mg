import type { AudioChunk } from "./audio.js";

// signal: once it has fired, the call yields no more chunks and throws
// signal.reason unchanged, whatever it is. A failure the call had already
// reached before it fired is thrown instead. "Fired" is judged when the
// call is about to yield, end or throw; a wait in progress ends when it fires.
export type SpeechOptions = { signal?: AbortSignal };
export interface SpeechSynthesizer {
  readonly name?: string;
  // One call per text. Every chunk declares its own format.
  synthesize(
    text: string,
    options?: SpeechOptions,
  ): AsyncIterable<AudioChunk>;
}
