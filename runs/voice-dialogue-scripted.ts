// 書き方は packages/runner/agent-guide.md を見てください。
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { runDialogue } from "@mg/dialogue";
import type {
  AudioChunk,
  AudioFormat,
  Clock,
  RecordedUtterance,
} from "@mg/voice";
import {
  createRecordedListener,
  createRecordingPlayer,
} from "@mg/voice";
import type {
  DialogueCollaborators,
  TraceWriter,
} from "./voice-dialogue.build.ts";
import {
  createDialogueCollaborators,
  createTraceWriter,
  printEvent,
} from "./voice-dialogue.build.ts";
import { outputPath } from "./outputs.ts";
import {
  exchangeCount,
  requestLimit,
  stopCheckMs,
  wording,
} from "./voice-dialogue.values.ts";

export type ScriptedCollaborators = DialogueCollaborators;

const CHUNK_MS = 100;

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const realClock: Clock = {
  now: () => performance.now(),
  sleep: (ms, signal) =>
    sleep(ms, undefined, { signal }).then(() => undefined),
};

const readWav = (path: string, file: Buffer): AudioChunk[] => {
  if (
    file.toString("ascii", 0, 4) !== "RIFF" ||
    file.toString("ascii", 8, 12) !== "WAVE"
  ) {
    throw new Error(`${path}: not a WAV file`);
  }
  let format: AudioFormat | undefined;
  let offset = 12;
  while (offset + 8 <= file.length) {
    const id = file.toString("ascii", offset, offset + 4);
    const size = file.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt ") {
      const audioFormat = file.readUInt16LE(body);
      const bits = file.readUInt16LE(body + 14);
      if (audioFormat !== 1 || bits !== 16) {
        throw new Error(`${path}: only 16-bit PCM WAV is supported`);
      }
      format = {
        encoding: "pcm-s16le",
        channels: file.readUInt16LE(body + 2),
        sampleRate: file.readUInt32LE(body + 4),
      };
    } else if (id === "data") {
      if (format === undefined) {
        throw new Error(`${path}: data chunk before fmt chunk`);
      }
      const data = file.subarray(
        body,
        Math.min(body + size, file.length),
      );
      const bytesPerChunk =
        Math.floor((format.sampleRate * CHUNK_MS) / 1000) *
        format.channels *
        2;
      const chunks: AudioChunk[] = [];
      for (let at = 0; at < data.length; at += bytesPerChunk) {
        chunks.push({
          format,
          data: data.subarray(at, at + bytesPerChunk),
        });
      }
      return chunks;
    }
    offset = body + size + (size % 2);
  }
  throw new Error(`${path}: no data chunk in WAV file`);
};

type ScriptLine = { wav: string; at: number };

const parseScript = (text: string): ScriptLine[] => {
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed)) {
    throw new Error("the script must be a JSON array");
  }
  return parsed.map((line: unknown, index) => {
    const { wav, at } = (line ?? {}) as Partial<ScriptLine>;
    if (typeof wav !== "string" || typeof at !== "number") {
      throw new Error(
        `script line ${index} must be {"wav": <path>, "at": <ms>}`,
      );
    }
    return { wav, at };
  });
};

const loadUtterances = async (
  scriptPath: string,
): Promise<RecordedUtterance[]> => {
  const lines = parseScript(await readFile(scriptPath, "utf8"));
  return Promise.all(
    lines.map(async ({ wav, at }) => ({
      at,
      audio: readWav(wav, await readFile(wav)),
    })),
  );
};

export const runScripted = async (options: {
  scriptPath: string;
  collaborators: ScriptedCollaborators;
  trace: TraceWriter;
  outputDir: string;
  out: (line: string) => void;
  err: (line: string) => void;
  signal?: AbortSignal;
  clock?: Clock;
}): Promise<number> => {
  const { out, err, trace } = options;
  const clock = options.clock ?? realClock;
  const signal = options.signal ?? new AbortController().signal;

  let utterances: RecordedUtterance[];
  try {
    utterances = await loadUtterances(options.scriptPath);
  } catch (error) {
    err(`failed script: ${messageOf(error)}`);
    return 1;
  }
  await mkdir(options.outputDir, { recursive: true });

  let code = 0;
  try {
    await runDialogue(
      {
        listener: createRecordedListener({ utterances, clock }),
        player: createRecordingPlayer({
          write: (name, bytes) =>
            writeFile(join(options.outputDir, name), bytes),
          clock,
        }),
        ...options.collaborators,
        wording,
        stopCheckMs,
        exchangeCount,
        requestLimit,
      },
      { signal, trace: trace.span, onEvent: printEvent(out, err) },
    );
  } catch (error) {
    if (signal.aborted) code = 130;
    else {
      err(`failed dialogue: ${messageOf(error)}`);
      code = 1;
    }
  }

  try {
    await trace.close();
  } catch (error) {
    err(`failed trace: ${messageOf(error)}`);
    code = 1;
  }
  return code;
};

const main = async (): Promise<number> => {
  const [scriptPath] = process.argv.slice(2);
  if (scriptPath === undefined) {
    console.error(
      'usage: node runs/voice-dialogue-scripted.ts "<script.json>"',
    );
    return 1;
  }

  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (geminiApiKey === undefined)
    throw new Error("GEMINI_API_KEY is not set");
  const openRouterApiKey = process.env.OPENROUTER_API_KEY;
  if (openRouterApiKey === undefined)
    throw new Error("OPENROUTER_API_KEY is not set");
  const typesafeApiKey = process.env.TYPESAFE_API_KEY;
  if (typesafeApiKey === undefined)
    throw new Error("TYPESAFE_API_KEY is not set");

  const outputDir = outputPath(`voice-dialogue-${Date.now()}`);
  const jsonlPath = outputPath("voice-dialogue-trace.jsonl");
  console.log(`output: ${outputDir}`);
  console.log(`trace: ${jsonlPath}`);

  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());

  return runScripted({
    scriptPath,
    collaborators: await createDialogueCollaborators({
      geminiApiKey,
      openRouterApiKey,
      typesafeApiKey,
    }),
    trace: await createTraceWriter({
      name: "voice-dialogue-scripted",
      jsonlPath,
    }),
    outputDir,
    out: (line) => console.log(line),
    err: (line) => console.error(line),
    signal: controller.signal,
  });
};

if (import.meta.main) process.exitCode = await main();
