import {
  createGeminiSynthesizer,
  createOpenAiSynthesizer,
} from "@mg/voice";
import type { SpeechSynthesizer } from "@mg/voice";

export type SpeechChoice =
  | { kind: "gemini" }
  | {
      kind: "openai";
      baseUrl: string;
      model: string;
      voice: string;
      apiKey?: string;
    };

export type SpeechSettings =
  { ok: true; choice: SpeechChoice } | { ok: false; message: string };

const given = (
  env: Record<string, string | undefined>,
  name: string,
): string | undefined => {
  const value = env[name];
  return value === undefined || value === "" ? undefined : value;
};

// Which synthesizer to speak through. With SPEECH_BASE_URL set it is a
// server that takes OpenAI's speech requests, and SPEECH_MODEL and
// SPEECH_VOICE must be set with it. Without it, Gemini.
export const readSpeechSettings = (
  env: Record<string, string | undefined>,
): SpeechSettings => {
  const baseUrl = given(env, "SPEECH_BASE_URL");
  if (baseUrl === undefined) {
    return { ok: true, choice: { kind: "gemini" } };
  }
  const model = given(env, "SPEECH_MODEL");
  const voice = given(env, "SPEECH_VOICE");
  if (model === undefined || voice === undefined) {
    const missing = [
      ...(model === undefined ? ["SPEECH_MODEL"] : []),
      ...(voice === undefined ? ["SPEECH_VOICE"] : []),
    ];
    return {
      ok: false,
      message: `${missing.join(" and ")} must be set when SPEECH_BASE_URL is set`,
    };
  }
  const apiKey = given(env, "SPEECH_API_KEY");
  return {
    ok: true,
    choice: {
      kind: "openai",
      baseUrl,
      model,
      voice,
      ...(apiKey !== undefined && { apiKey }),
    },
  };
};

export const createSpeechSynthesizer = (
  choice: SpeechChoice,
  geminiApiKey: string,
): SpeechSynthesizer =>
  choice.kind === "openai"
    ? createOpenAiSynthesizer(choice)
    : createGeminiSynthesizer({
        apiKey: geminiApiKey,
        voice: "Kore",
        language: "ja-JP",
      });
