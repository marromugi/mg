import { describe, expect, test } from "vitest";
import {
  readSpeechSettings,
  resolveSpeech,
} from "./speech-settings.ts";

describe("readSpeechSettings", () => {
  test("chooses Gemini when SPEECH_BASE_URL is not set", () => {
    expect(readSpeechSettings({})).toEqual({
      ok: true,
      choice: { kind: "gemini" },
    });
  });

  test("chooses Gemini when SPEECH_BASE_URL is empty, ignoring the other variables", () => {
    expect(
      readSpeechSettings({
        SPEECH_BASE_URL: "",
        SPEECH_MODEL: "m",
        SPEECH_VOICE: "v",
      }),
    ).toEqual({ ok: true, choice: { kind: "gemini" } });
  });

  test("chooses the speech server with its address, model and voice, and no key", () => {
    expect(
      readSpeechSettings({
        SPEECH_BASE_URL: "http://127.0.0.1:8088/v1",
        SPEECH_MODEL: "irodori-tts",
        SPEECH_VOICE: "none",
      }),
    ).toEqual({
      ok: true,
      choice: {
        kind: "openai",
        baseUrl: "http://127.0.0.1:8088/v1",
        model: "irodori-tts",
        voice: "none",
      },
    });
  });

  test("carries SPEECH_API_KEY when it is set", () => {
    expect(
      readSpeechSettings({
        SPEECH_BASE_URL: "http://h/v1",
        SPEECH_MODEL: "m",
        SPEECH_VOICE: "v",
        SPEECH_API_KEY: "secret",
      }),
    ).toEqual({
      ok: true,
      choice: {
        kind: "openai",
        baseUrl: "http://h/v1",
        model: "m",
        voice: "v",
        apiKey: "secret",
      },
    });
  });

  test("names SPEECH_MODEL when only it is missing", () => {
    expect(
      readSpeechSettings({
        SPEECH_BASE_URL: "http://h/v1",
        SPEECH_VOICE: "v",
      }),
    ).toEqual({
      ok: false,
      message: "SPEECH_MODEL must be set when SPEECH_BASE_URL is set",
    });
  });

  test("names SPEECH_VOICE when only it is missing", () => {
    expect(
      readSpeechSettings({
        SPEECH_BASE_URL: "http://h/v1",
        SPEECH_MODEL: "m",
      }),
    ).toEqual({
      ok: false,
      message: "SPEECH_VOICE must be set when SPEECH_BASE_URL is set",
    });
  });

  test("names both when both are missing", () => {
    expect(
      readSpeechSettings({ SPEECH_BASE_URL: "http://h/v1" }),
    ).toEqual({
      ok: false,
      message:
        "SPEECH_MODEL and SPEECH_VOICE must be set when SPEECH_BASE_URL is set",
    });
  });
});

describe("resolveSpeech", () => {
  const known = "Known engines: gemini, openai, irodori";

  test("speaks in the persona's irodori voice with the server address from the environment", () => {
    const speech = resolveSpeech(
      { engine: "irodori", name: "talker", tone: "落ち着いた声" },
      {
        SPEECH_BASE_URL: "http://127.0.0.1:8088/v1",
        SPEECH_VOICE: "x",
      },
    );

    expect(speech).toMatchObject({
      ok: true,
      line: "voice: irodori talker (persona)",
    });
    expect(speech.ok && speech.synthesizer.name).toBe("irodori");
  });

  test("speaks in the persona's openai voice with the model from the environment", () => {
    const speech = resolveSpeech(
      { engine: "openai", name: "alloy" },
      { SPEECH_BASE_URL: "http://h/v1", SPEECH_MODEL: "tts-1" },
    );

    expect(speech).toMatchObject({
      ok: true,
      line: "voice: openai alloy (persona)",
    });
  });

  test("speaks in the persona's gemini voice with the key from the environment", () => {
    const speech = resolveSpeech(
      { engine: "gemini", name: "Puck" },
      { GEMINI_API_KEY: "k" },
    );

    expect(speech).toMatchObject({
      ok: true,
      line: "voice: gemini Puck (persona)",
    });
  });

  test("speaks in the voice the environment names when the persona has none", () => {
    expect(
      resolveSpeech(undefined, {
        SPEECH_BASE_URL: "http://h/v1",
        SPEECH_MODEL: "m",
        SPEECH_VOICE: "v",
        GEMINI_API_KEY: "k",
      }),
    ).toMatchObject({
      ok: true,
      line: "voice: openai v (environment)",
    });
    expect(
      resolveSpeech(undefined, { GEMINI_API_KEY: "k" }),
    ).toMatchObject({
      ok: true,
      line: "voice: gemini Kore (environment)",
    });
  });

  test("ignores the environment's voice name when the persona names a voice", () => {
    expect(
      resolveSpeech(
        { engine: "irodori", name: "talker" },
        { SPEECH_BASE_URL: "http://h/v1", SPEECH_VOICE: "other" },
      ),
    ).toMatchObject({
      ok: true,
      line: "voice: irodori talker (persona)",
    });
  });

  test("names an engine it does not know and the engines it knows", () => {
    expect(resolveSpeech({ engine: "espeak", name: "n" }, {})).toEqual({
      ok: false,
      message: `cannot speak with the espeak engine: it is not a known engine. ${known}`,
    });
  });

  test("names the server address an irodori voice lacks", () => {
    expect(resolveSpeech({ engine: "irodori", name: "n" }, {})).toEqual(
      {
        ok: false,
        message: `cannot speak with the irodori engine: SPEECH_BASE_URL not set. ${known}`,
      },
    );
  });

  test("names the address and model an openai voice lacks", () => {
    expect(resolveSpeech({ engine: "openai", name: "n" }, {})).toEqual({
      ok: false,
      message: `cannot speak with the openai engine: SPEECH_BASE_URL and SPEECH_MODEL not set. ${known}`,
    });
  });

  test("names the key a gemini voice lacks", () => {
    expect(resolveSpeech({ engine: "gemini", name: "n" }, {})).toEqual({
      ok: false,
      message: `cannot speak with the gemini engine: GEMINI_API_KEY not set. ${known}`,
    });
  });

  test("stops on a tone for the gemini engine", () => {
    const speech = resolveSpeech(
      { engine: "gemini", name: "n", tone: "低い声" },
      { GEMINI_API_KEY: "k" },
    );

    expect(speech.ok).toBe(false);
    expect(!speech.ok && speech.message).toMatch(
      /^cannot speak with the gemini engine: .*tone.*\. Known engines: gemini, openai, irodori$/,
    );
  });

  test("passes on the environment's failure when the persona has no voice and the variables are incomplete", () => {
    expect(
      resolveSpeech(undefined, { SPEECH_BASE_URL: "http://h/v1" }),
    ).toEqual({
      ok: false,
      message:
        "SPEECH_MODEL and SPEECH_VOICE must be set when SPEECH_BASE_URL is set",
    });
  });
});
