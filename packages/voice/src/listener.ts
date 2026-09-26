import type { AudioChunk } from "./audio.js";

// One HeardUtterance is yielded when the speaker starts talking (voice
// activity or push-to-talk alike). Its audio ends when they stop.
// The iterable ending means the listener is done; throwing means it failed.
export type HeardUtterance = { audio: AsyncIterable<AudioChunk> };
export interface Listener {
  listen(signal: AbortSignal): AsyncIterable<HeardUtterance>;
}
