import type { AudioChunk } from "./audio.js";

// A microphone gives one continuous stream of audio from open until it is
// stopped. Once signal has fired, the stream ends without error. A
// failure of the microphone is thrown by the stream.
export interface Microphone {
  open(signal: AbortSignal): AsyncIterable<AudioChunk>;
}
