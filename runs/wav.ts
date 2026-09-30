import type { AudioChunk, AudioFormat } from "@mg/voice";

const CHUNK_MS = 100;

// Splits a 16-bit PCM WAV file into chunks of 100 ms. Throws, naming
// the file, when it is anything else.
export const wavChunks = (
  name: string,
  bytes: Uint8Array,
): AudioChunk[] => {
  const file = Buffer.from(bytes);
  if (
    file.toString("ascii", 0, 4) !== "RIFF" ||
    file.toString("ascii", 8, 12) !== "WAVE"
  ) {
    throw new Error(`${name}: not a WAV file`);
  }
  let format: AudioFormat | undefined;
  let offset = 12;
  while (offset + 8 <= file.length) {
    const id = file.toString("ascii", offset, offset + 4);
    const size = file.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt ") {
      const audioFormat = file.readUInt16LE(body);
      const bits = file.readUInt16LE(body + 14);
      if (audioFormat !== 1 || bits !== 16) {
        throw new Error(`${name}: only 16-bit PCM WAV is supported`);
      }
      format = {
        encoding: "pcm-s16le",
        channels: file.readUInt16LE(body + 2),
        sampleRate: file.readUInt32LE(body + 4),
      };
    } else if (id === "data") {
      if (format === undefined) {
        throw new Error(`${name}: data chunk comes before fmt chunk`);
      }
      const data = file.subarray(
        body,
        Math.min(body + size, file.length),
      );
      const step =
        Math.floor((format.sampleRate * CHUNK_MS) / 1000) *
        format.channels *
        2;
      const chunks: AudioChunk[] = [];
      for (let at = 0; at < data.length; at += step) {
        chunks.push({ format, data: data.subarray(at, at + step) });
      }
      return chunks;
    }
    offset = body + size + (size % 2);
  }
  throw new Error(`${name}: no data chunk in WAV file`);
};
