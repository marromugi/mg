import type { AudioChunk } from "./audio.js";
import { createChannel } from "./channel.js";
import type { Channel } from "./channel.js";
import type { HeardUtterance, Listener } from "./listener.js";
import type { Microphone } from "./microphone.js";

const WINDOW_MS = 20;

type Window = { chunk: AudioChunk; loud: boolean };

// The loudness of 16-bit samples as the RMS in dB relative to full scale.
// Silence is -Infinity.
const levelOf = (data: Uint8Array): number => {
  const view = new DataView(data.buffer, data.byteOffset, data.length);
  const count = Math.floor(data.length / 2);
  let sum = 0;
  for (let at = 0; at < count; at++) {
    const sample = view.getInt16(at * 2, true) / 32768;
    sum += sample * sample;
  }
  return 10 * Math.log10(sum / count);
};

const windowsOf = (ms: number): number => Math.ceil(ms / WINDOW_MS);

// Reads a microphone and cuts its stream into utterances by loudness.
// Audio is measured in windows of 20 ms. An utterance starts once the
// windows have stayed at or above `levelDb` (dB relative to full scale)
// for `startMs`, and carries the `leadMs` before the first of them. It
// ends once the windows have stayed below the level for `endMs`; that
// quiet stretch is part of its audio. One still open when the microphone
// ends is ended there.
export const createLevelListener = ({
  microphone,
  levelDb,
  startMs,
  endMs,
  leadMs,
}: {
  microphone: Microphone;
  levelDb: number;
  startMs: number;
  endMs: number;
  leadMs: number;
}): Listener => ({
  async *listen(signal): AsyncIterable<HeardUtterance> {
    const stop = new AbortController();
    const relay = () => stop.abort();
    if (signal.aborted) stop.abort();
    else signal.addEventListener("abort", relay, { once: true });
    const utterances = createChannel<HeardUtterance>(signal);
    const startWindows = windowsOf(startMs);
    const endWindows = windowsOf(endMs);
    const leadWindows = windowsOf(leadMs);

    const pump = (async () => {
      let open: Channel<AudioChunk> | undefined;
      let recent: Window[] = [];
      let loudRun = 0;
      let quietRun = 0;
      const take = (window: Window) => {
        if (open === undefined) {
          recent.push(window);
          loudRun = window.loud ? loudRun + 1 : 0;
          recent = recent.slice(-(leadWindows + loudRun));
          if (loudRun < startWindows) return;
          open = createChannel<AudioChunk>(signal);
          for (const kept of recent) open.push(kept.chunk);
          utterances.push({ audio: open.items });
          recent = [];
          loudRun = 0;
          quietRun = 0;
          return;
        }
        open.push(window.chunk);
        quietRun = window.loud ? 0 : quietRun + 1;
        if (quietRun >= endWindows) {
          open.end();
          open = undefined;
        }
      };
      try {
        let format: AudioChunk["format"] | undefined;
        let pending = new Uint8Array(0);
        for await (const chunk of microphone.open(stop.signal)) {
          format ??= chunk.format;
          if (
            chunk.format.sampleRate !== format.sampleRate ||
            chunk.format.channels !== format.channels
          ) {
            throw new Error(
              "the microphone changed its audio format while open",
            );
          }
          const bytes =
            Math.floor((format.sampleRate * WINDOW_MS) / 1000) *
            format.channels *
            2;
          if (!(bytes > 0)) {
            throw new RangeError(
              `a ${WINDOW_MS} ms window holds no audio at ${format.sampleRate} Hz with ${format.channels} channels`,
            );
          }
          const joined = new Uint8Array(
            pending.length + chunk.data.length,
          );
          joined.set(pending);
          joined.set(chunk.data, pending.length);
          let at = 0;
          for (; at + bytes <= joined.length; at += bytes) {
            const data = joined.slice(at, at + bytes);
            take({
              chunk: { format, data },
              loud: levelOf(data) >= levelDb,
            });
          }
          pending = joined.slice(at);
        }
        if (open !== undefined && format !== undefined) {
          if (pending.length > 0) open.push({ format, data: pending });
          open.end();
        }
        utterances.end();
      } catch (error) {
        open?.fail(error);
        utterances.fail(error);
      }
    })();

    try {
      yield* utterances.items;
    } finally {
      signal.removeEventListener("abort", relay);
      stop.abort();
      await pump;
    }
  },
});
