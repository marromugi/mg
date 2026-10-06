import type { AudioFormat } from "../audio.js";
import { OpenAiSpeechResponseError } from "./errors.js";

export type WavHeader = {
  format: AudioFormat;
  // Offset of the first sample in the bytes read so far.
  dataStart: number;
  // Bytes of sample data the header declares. undefined when it says
  // 0 or 0xFFFFFFFF, which a streamed WAV uses: read to the end.
  dataLength: number | undefined;
};

const UNKNOWN_LENGTH = 0xffffffff;

const describeBytes = (bytes: Uint8Array): string =>
  Array.from(bytes.subarray(0, 12), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join(" ");

// Reads a WAV header from the start of `bytes`. Returns undefined when
// more bytes are needed. Throws OpenAiSpeechResponseError when what
// arrived is not 16-bit PCM WAV.
export const parseWavHeader = (
  bytes: Uint8Array,
): WavHeader | undefined => {
  if (bytes.length < 12) return undefined;
  const view = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  );
  const tag = (at: number): string =>
    String.fromCharCode(...bytes.subarray(at, at + 4));

  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") {
    throw new OpenAiSpeechResponseError(
      `OpenAI speech response is not 16-bit PCM WAV: it does not start with RIFF and WAVE (first bytes: ${describeBytes(bytes)})`,
    );
  }

  let format: AudioFormat | undefined;
  let offset = 12;
  for (;;) {
    if (offset + 8 > bytes.length) return undefined;
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "data") {
      if (format === undefined) {
        throw new OpenAiSpeechResponseError(
          "OpenAI speech response has a data chunk before its fmt chunk",
        );
      }
      return {
        format,
        dataStart: body,
        dataLength:
          size === 0 || size === UNKNOWN_LENGTH ? undefined : size,
      };
    }
    // Any other chunk is read once all of it has arrived.
    if (body + size > bytes.length) return undefined;
    if (id === "fmt ") {
      if (size < 16) {
        throw new OpenAiSpeechResponseError(
          `OpenAI speech response has a fmt chunk of ${size} bytes, fewer than the 16 needed`,
        );
      }
      const audioFormat = view.getUint16(body, true);
      const channels = view.getUint16(body + 2, true);
      const sampleRate = view.getUint32(body + 4, true);
      const bits = view.getUint16(body + 14, true);
      if (audioFormat !== 1 || bits !== 16) {
        throw new OpenAiSpeechResponseError(
          `OpenAI speech response is not 16-bit PCM WAV: received format code ${audioFormat} with ${bits} bits per sample`,
        );
      }
      if (channels === 0 || sampleRate === 0) {
        throw new OpenAiSpeechResponseError(
          `OpenAI speech response declares ${channels} channels at ${sampleRate} Hz`,
        );
      }
      format = { encoding: "pcm-s16le", sampleRate, channels };
    }
    offset = body + size + (size % 2);
  }
};
