import { readFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import type { AudioChunk } from "@mg/voice";
import { createGeminiTranscriber } from "@mg/voice";
import { term } from "@mg/term";
import { readWav } from "./wav-file.ts";

const CHUNK_MS = 100;

const [wavPath, ...languages] = process.argv.slice(2);
if (wavPath === undefined) {
  console.error(
    "usage: gemini-stt.ts <wav> [language...]\nthe WAV must be 16-bit PCM, 16 kHz, mono",
  );
  process.exit(1);
}

const apiKey = process.env.GEMINI_API_KEY;
if (apiKey === undefined) throw new Error("GEMINI_API_KEY is not set");

const elapsed = (from: number) =>
  `${(performance.now() - from).toFixed(0)} ms`;

try {
  const { format, data } = readWav(await readFile(wavPath));
  const bytesPerChunk =
    Math.floor((format.sampleRate * CHUNK_MS) / 1000) *
    format.channels *
    2;

  const transcriber = createGeminiTranscriber({ apiKey });
  const start = performance.now();
  let lastChunkAt = start;

  const audio = (async function* (): AsyncGenerator<AudioChunk> {
    for (let at = 0; at < data.length; at += bytesPerChunk) {
      const wait =
        start + (at / bytesPerChunk) * CHUNK_MS - performance.now();
      if (wait > 0) await sleep(wait);
      lastChunkAt = performance.now();
      yield { format, data: data.subarray(at, at + bytesPerChunk) };
    }
    console.log(
      term.paint(
        "muted",
        `${term.mark.muted} audio ended at ${elapsed(start)}`,
      ),
    );
  })();

  const languageNote =
    languages.length > 0 ? ` (${languages.join(", ")})` : "";
  console.log(
    term.paint(
      "strong",
      `${term.mark.strong} transcribing ${wavPath}${languageNote}`,
    ),
  );

  for await (const event of transcriber.transcribe(audio, {
    ...(languages.length > 0 && { languages }),
  })) {
    if (event.type === "partial") {
      console.log(`  partial ${elapsed(start)}: ${event.text}`);
    } else {
      const finalAt = performance.now();
      console.log(
        term.paint(
          "success",
          `${term.mark.success} final: ${event.text}`,
        ),
      );
      console.log(
        `  last chunk to final: ${(finalAt - lastChunkAt).toFixed(0)} ms`,
      );
    }
  }
} catch (error) {
  const message =
    error instanceof Error ? error.message : String(error);
  console.error(term.paint("error", `${term.mark.error} ${message}`));
  process.exitCode = 1;
}
