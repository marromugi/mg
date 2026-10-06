import { describe, expect, test } from "vitest";
import { readSpeechSettings } from "./speech-settings.ts";

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
