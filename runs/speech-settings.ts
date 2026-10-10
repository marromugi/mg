import type { PersonaVoice } from "@mg/persona";
import {
  createGeminiSynthesizer,
  createIrodoriSynthesizer,
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

type Environment = Record<string, string | undefined>;

type Voice = { name: string; tone?: string | undefined };

// The synthesizer an engine makes, or the variables it lacks.
type Made =
  | { ok: true; synthesizer: SpeechSynthesizer }
  | { ok: false; missing: string[] };

const lacking = (env: Environment, names: string[]): string[] =>
  names.filter((name) => given(env, name) === undefined);

const valueOf = (env: Environment, name: string): string =>
  given(env, name) ?? "";

const withTone = (voice: Voice) =>
  voice.tone === undefined ? {} : { tone: voice.tone };

const withKey = (env: Environment) => {
  const apiKey = given(env, "SPEECH_API_KEY");
  return apiKey === undefined ? {} : { apiKey };
};

const engines: Record<
  string,
  (voice: Voice, env: Environment) => Made
> = {
  gemini: (voice, env) => {
    const missing = lacking(env, ["GEMINI_API_KEY"]);
    if (missing.length > 0) return { ok: false, missing };
    return {
      ok: true,
      synthesizer: createGeminiSynthesizer({
        apiKey: valueOf(env, "GEMINI_API_KEY"),
        voice: voice.name,
        language: "ja-JP",
        ...withTone(voice),
      }),
    };
  },
  openai: (voice, env) => {
    const missing = lacking(env, ["SPEECH_BASE_URL", "SPEECH_MODEL"]);
    if (missing.length > 0) return { ok: false, missing };
    return {
      ok: true,
      synthesizer: createOpenAiSynthesizer({
        baseUrl: valueOf(env, "SPEECH_BASE_URL"),
        model: valueOf(env, "SPEECH_MODEL"),
        voice: voice.name,
        ...withTone(voice),
        ...withKey(env),
      }),
    };
  },
  irodori: (voice, env) => {
    const missing = lacking(env, ["SPEECH_BASE_URL"]);
    if (missing.length > 0) return { ok: false, missing };
    return {
      ok: true,
      synthesizer: createIrodoriSynthesizer({
        baseUrl: valueOf(env, "SPEECH_BASE_URL"),
        voice: voice.name,
        ...withTone(voice),
        ...withKey(env),
      }),
    };
  },
};

export type Speech =
  | { ok: true; synthesizer: SpeechSynthesizer; line: string }
  | { ok: false; message: string };

const known = Object.keys(engines).join(", ");

const unusable = (engine: string, what: string): Speech => ({
  ok: false,
  message: `cannot speak with the ${engine} engine: ${what}. Known engines: ${known}`,
});

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const fromEngine = (
  engine: string,
  voice: Voice,
  env: Environment,
  source: "persona" | "environment",
): Speech => {
  const make = Object.hasOwn(engines, engine)
    ? engines[engine]
    : undefined;
  if (make === undefined) {
    return unusable(engine, "it is not a known engine");
  }
  try {
    const made = make(voice, env);
    if (!made.ok) {
      return unusable(engine, `${made.missing.join(" and ")} not set`);
    }
    return {
      ok: true,
      synthesizer: made.synthesizer,
      line: `voice: ${engine} ${voice.name} (${source})`,
    };
  } catch (error) {
    return unusable(engine, messageOf(error));
  }
};

// The synthesizer to speak through. A persona's voice names the engine,
// the voice, and the tone, and the environment gives what belongs to the
// machine. Without a persona voice, readSpeechSettings decides.
export const resolveSpeech = (
  voice: PersonaVoice | undefined,
  env: Environment,
): Speech => {
  if (voice !== undefined) {
    return fromEngine(voice.engine, voice, env, "persona");
  }
  const settings = readSpeechSettings(env);
  if (!settings.ok) return { ok: false, message: settings.message };
  const { choice } = settings;
  return choice.kind === "openai"
    ? fromEngine("openai", { name: choice.voice }, env, "environment")
    : fromEngine("gemini", { name: "Kore" }, env, "environment");
};
