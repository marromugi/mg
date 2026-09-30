import { createMemoryConversationStore } from "@mg/conversation";
import { createOpenRouterProvider } from "@mg/core";
import { runDialogue } from "@mg/dialogue";
import {
  createGeminiSynthesizer,
  createGeminiTranscriber,
} from "@mg/voice";
import { createSampleJevEstimator } from "./jev-estimator.ts";
import { spawnProcess } from "./node-spawn.ts";
import { outputPath } from "./outputs.ts";
import {
  createDialogueCollaborators,
  createTalkerConfig,
  createWorkerConfig,
  openSessionTrace,
} from "./voice-dialogue.build.ts";
import { runLive } from "./voice-dialogue.run.ts";

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

const runTracePath = outputPath("voice-dialogue-run-trace.jsonl");

process.exitCode = await runLive({
  input: process.stdin,
  spawn: spawnProcess,
  createCollaborators: () =>
    createDialogueCollaborators({
      transcriber: createGeminiTranscriber({ apiKey: geminiApiKey }),
      synthesizer: createGeminiSynthesizer({
        apiKey: geminiApiKey,
        voice: "Kore",
        language: "ja-JP",
      }),
      estimator,
      talker: {
        config: createTalkerConfig({
          provider,
          jsonlPath: runTracePath,
        }),
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
    }),
  dialogue: runDialogue,
  openTrace: () =>
    openSessionTrace(
      outputPath("voice-dialogue-trace.jsonl"),
      "voice-dialogue",
    ),
  out: (line) => console.log(line),
  err: (line) => console.error(line),
});
