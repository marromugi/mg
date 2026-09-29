import type { AudioChunk, AudioFormat } from "../audio.js";

const BYTES_PER_SAMPLE = 2; // pcm-s16le

export function chunkDurationMs(chunk: AudioChunk): number {
  const { sampleRate, channels } = chunk.format;
  return (
    (chunk.data.length / (BYTES_PER_SAMPLE * channels * sampleRate)) *
    1000
  );
}

// A canonical 44-byte header followed by the samples.
export function encodeWav(
  format: AudioFormat,
  data: Uint8Array,
): Uint8Array {
  const blockAlign = format.channels * BYTES_PER_SAMPLE;
  const out = new Uint8Array(44 + data.length);
  const view = new DataView(out.buffer);
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i += 1) out[at + i] = s.charCodeAt(i);
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + data.length, true);
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
  view.setUint32(40, data.length, true);
  out.set(data, 44);
  return out;
}
