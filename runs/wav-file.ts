import type { AudioFormat } from "@mg/voice";

// Reads a 16-bit PCM WAV file into its format and sample bytes.
export const readWav = (
  file: Buffer,
): { format: AudioFormat; data: Buffer } => {
  if (
    file.toString("ascii", 0, 4) !== "RIFF" ||
    file.toString("ascii", 8, 12) !== "WAVE"
  ) {
    throw new Error("not a WAV file");
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
        throw new Error("only 16-bit PCM WAV is supported");
      }
      format = {
        encoding: "pcm-s16le",
        channels: file.readUInt16LE(body + 2),
        sampleRate: file.readUInt32LE(body + 4),
      };
    } else if (id === "data") {
      if (format === undefined) throw new Error("data before fmt");
      return {
        format,
        data: file.subarray(body, Math.min(body + size, file.length)),
      };
    }
    offset = body + size + (size % 2);
  }
  throw new Error("no data chunk in WAV file");
};
