import type { SpeechSynthesizer } from "../synthesizer.js";
import { createWavSynthesizer } from "../openai/speech.js";

const DEFAULT_MODEL = "irodori-tts";

export type IrodoriSynthesizerOptions = {
  baseUrl: string;
  voice: string;
  tone?: string;
  model?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
};

// An Irodori-TTS server takes OpenAI's speech requests. It reads the
// tone as the caption in its own `irodori` options.
export const createIrodoriSynthesizer = (
  options: IrodoriSynthesizerOptions,
): SpeechSynthesizer => {
  const { tone, model, ...rest } = options;
  if (tone !== undefined && tone.trim() === "") {
    throw new RangeError("tone must not be empty");
  }
  return createWavSynthesizer({
    ...rest,
    model: model ?? DEFAULT_MODEL,
    name: "irodori",
    ...(tone !== undefined && {
      extraBody: { irodori: { caption: tone.trim() } },
    }),
  });
};
