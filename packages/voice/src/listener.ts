import type { AudioChunk } from "./audio.js";

// One HeardUtterance is yielded when the speaker starts talking (voice
// activity or push-to-talk alike). Its audio ends when they stop, or
// earlier, cut, when listening is stopped through the signal of listen.
// The iterable ending means the listener is done; throwing means it failed.
export type HeardUtterance = { audio: AsyncIterable<AudioChunk> };
export interface Listener {
  // Once signal has fired, the returned stream and the audio of every
  // utterance it yielded yield nothing more and end without error. A failure
  // the listener had already reached before it fired is thrown by the
  // returned stream instead.
  listen(signal: AbortSignal): AsyncIterable<HeardUtterance>;
}
