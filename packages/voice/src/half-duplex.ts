import type { AudioChunk } from "./audio.js";
import type { Microphone } from "./microphone.js";
import type { Player } from "./player.js";

export type HalfDuplexOptions = {
  microphone: Microphone;
  player: Player;
  // How long after the player stopped sounding the microphone still
  // hears nothing, in ms.
  tailMs: number;
  now?: () => number;
};

// Joins a microphone and a player so that the microphone hears nothing
// while the player is sounding. A play sounds from the first chunk of its
// audio that reaches the given player until it returns. A chunk that
// arrives while a play sounds, or less than tailMs after the last one
// ended, keeps its length
// and format and carries silence instead of its audio.
export const createHalfDuplex = (
  options: HalfDuplexOptions,
): { microphone: Microphone; player: Player } => {
  const now = options.now ?? Date.now;
  let playing = 0;
  let endedAt = Number.NEGATIVE_INFINITY;

  const player: Player = {
    async play(index, audio) {
      let sounding = false;
      const heard = (async function* () {
        for await (const chunk of audio) {
          if (!sounding) {
            sounding = true;
            playing += 1;
          }
          yield chunk;
        }
      })();
      try {
        return await options.player.play(index, heard);
      } finally {
        if (sounding) {
          playing -= 1;
          if (playing === 0) endedAt = now();
        }
      }
    },
    stop: () => options.player.stop(),
  };

  const silenced = (): boolean =>
    playing > 0 || now() - endedAt < options.tailMs;

  const microphone: Microphone = {
    async *open(signal) {
      for await (const chunk of options.microphone.open(signal)) {
        const quiet: AudioChunk = {
          format: chunk.format,
          data: new Uint8Array(chunk.data.length),
        };
        yield silenced() ? quiet : chunk;
      }
    },
  };

  return { microphone, player };
};
