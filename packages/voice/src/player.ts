import type { AudioChunk } from "./audio.js";

// Plays sentences in index order, one after another. play resolves with
// { played: true } when that sentence fully played, { played: false } when
// it was stopped; it rejects when the device fails. stop() stops the current
// sentence at once and resolves every pending play with played: false.
export type PlaybackEnd = { played: true } | { played: false };
export interface Player {
  play(
    index: number,
    audio: AsyncIterable<AudioChunk>,
  ): Promise<PlaybackEnd>;
  stop(): void;
}
