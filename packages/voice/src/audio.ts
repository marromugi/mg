export type AudioEncoding = "pcm-s16le";
export type AudioFormat = {
  encoding: AudioEncoding;
  sampleRate: number; // samples per second
  channels: number;
};
export type AudioChunk = { format: AudioFormat; data: Uint8Array };
