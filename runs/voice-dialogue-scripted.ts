import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createMemoryConversationStore } from "@mg/conversation";
import { createOpenRouterProvider } from "@mg/core";
import { runDialogue } from "@mg/dialogue";
import {
  createGeminiSynthesizer,
  createGeminiTranscriber,
} from "@mg/voice";
import { createSampleJevEstimator } from "./jev-estimator.ts";
import { readOneInput } from "./one-input.ts";
import { outputPath } from "./outputs.ts";
import {
  createTalkerConfig,
  createWorkerConfig,
  openSessionTrace,
} from "./voice-dialogue.build.ts";
import { runScripted } from "./voice-dialogue-scripted.run.ts";

const read = readOneInput(
  process.argv.slice(2),
  "runs/voice-dialogue-scripted.ts",
);
if (!read.ok) {
  console.error(read.usage);
  process.exit(2);
}

const need = (name: string): string => {
  const value = process.env[name];
  if (value === undefined) throw new Error(`${name} is not set`);
  return value;
};

const geminiApiKey = need("GEMINI_API_KEY");
const provider = createOpenRouterProvider({
  apiKey: need("OPENROUTER_API_KEY"),
});
const estimator = createSampleJevEstimator({
  apiKey: need("TYPESAFE_API_KEY"),
});

const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
const outputDir = outputPath(`voice-dialogue-scripted-${stamp}`);
const runTracePath = outputPath(
  "voice-dialogue-scripted-run-trace.jsonl",
);

const aborter = new AbortController();
process.once("SIGINT", () => aborter.abort());

process.exitCode = await runScripted({
  scriptPath: read.input,
  readFile,
  collaborators: {
    transcriber: createGeminiTranscriber({ apiKey: geminiApiKey }),
    synthesizer: createGeminiSynthesizer({
      apiKey: geminiApiKey,
      voice: "Kore",
      language: "ja-JP",
    }),
    estimator,
    talker: {
      config: createTalkerConfig({ provider, jsonlPath: runTracePath }),
      store: createMemoryConversationStore(),
      id: "talker",
    },
    worker: {
      config: createWorkerConfig({
        provider,
        estimator,
        jsonlPath: runTracePath,
      }),
      store: createMemoryConversationStore(),
      id: "worker",
    },
  },
  dialogue: runDialogue,
  clock: {
    now: () => performance.now(),
    sleep: (ms, signal) => sleep(ms, undefined, { signal }),
  },
  writeWav: async (name, bytes) => {
    await mkdir(outputDir, { recursive: true });
    await writeFile(join(outputDir, name), bytes);
  },
  outputDir,
  openTrace: () =>
    openSessionTrace(
      outputPath("voice-dialogue-scripted-trace.jsonl"),
      "voice-dialogue-scripted",
    ),
  out: (line) => console.log(line),
  err: (line) => console.error(line),
  signal: aborter.signal,
});
