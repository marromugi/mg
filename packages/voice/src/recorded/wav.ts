import type { AudioChunk, AudioFormat } from "../audio.js";

const BYTES_PER_SAMPLE = 2; // pcm-s16le
const HEADER_BYTES = 44;

export const chunkDurationMs = (chunk: AudioChunk): number => {
  const { sampleRate, channels } = chunk.format;
  return (
    (chunk.data.length / (BYTES_PER_SAMPLE * channels * sampleRate)) *
    1000
  );
};

// A canonical 44-byte header followed by the samples.
export const encodeWav = (
  format: AudioFormat,
  chunks: Uint8Array[],
): Uint8Array => {
  const size = chunks.reduce((sum, c) => sum + c.length, 0);
  const blockAlign = format.channels * BYTES_PER_SAMPLE;
  const out = new Uint8Array(HEADER_BYTES + size);
  const view = new DataView(out.buffer);
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i += 1) out[at + i] = s.charCodeAt(i);
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + size, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, format.channels, true);
  view.setUint32(24, format.sampleRate, true);
  view.setUint32(28, format.sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, BYTES_PER_SAMPLE * 8, true);
  text(36, "data");
  view.setUint32(40, size, true);
  let at = HEADER_BYTES;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
};
