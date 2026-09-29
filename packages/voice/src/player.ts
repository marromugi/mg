import type { AudioChunk } from "./audio.js";

// Plays sentences one after another.
//
// The index is a sentence's position among the sentences of one text
// that the caller plays, counted from 0. A sentence the caller does not
// play takes no index.
// - Index 0 begins a new text. It comes only when no sentence of an
//   earlier text is still playing or waiting.
// - stop() ends the text it cut at once, so index 0 may follow it.
// - Within a text, the indices come in call order, each one more than
//   the previous call's. A sentence starts only after the one before it
//   has ended.
//
// play resolves with { played: true } when that sentence fully played,
// and { played: false } when it was stopped. It rejects, saying which
// rule it broke, when the index breaks the rules above: index 0 while an
// earlier text is playing or waiting, an index above 0 with no text
// begun, or an index that repeats or skips. It rejects, with the reason,
// when it cannot play the audio as given; each implementation names what
// it cannot play. Otherwise it rejects only when its device fails.
//
// stop() stops the current sentence at once and resolves every pending
// play with played: false.
export type PlaybackEnd = { played: true } | { played: false };
export interface Player {
  play(
    index: number,
    audio: AsyncIterable<AudioChunk>,
  ): Promise<PlaybackEnd>;
  stop(): void;
}
