import type { Transcriber } from "../transcriber.js";

export {
  GeminiTranscriptionResponseError,
  GeminiTranscriptionTransportError,
  isGeminiTranscriptionError,
} from "./errors.js";
export type { GeminiTranscriptionError } from "./errors.js";

export type GeminiTranscriberOptions = {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  WebSocket?: typeof WebSocket;
};

export const createGeminiTranscriber = (
  _options: GeminiTranscriberOptions,
): Transcriber => {
  throw new Error("not implemented");
};
