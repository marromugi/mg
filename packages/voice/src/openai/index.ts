import type { SpeechSynthesizer } from "../synthesizer.js";
import { createWavSynthesizer } from "./speech.js";

export {
  OpenAiSpeechHttpError,
  OpenAiSpeechResponseError,
  OpenAiSpeechTransportError,
  isOpenAiSpeechError,
} from "./errors.js";
export type { OpenAiSpeechError } from "./errors.js";

export type OpenAiSynthesizerOptions = {
  baseUrl: string;
  model: string;
  voice: string;
  tone?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
};

export const createOpenAiSynthesizer = (
  options: OpenAiSynthesizerOptions,
): SpeechSynthesizer => {
  const { tone, ...rest } = options;
  if (tone !== undefined && tone.trim() === "") {
    throw new RangeError("tone must not be empty");
  }
  return createWavSynthesizer({
    ...rest,
    name: "openai",
    ...(tone !== undefined && {
      extraBody: { instructions: tone.trim() },
    }),
  });
};
