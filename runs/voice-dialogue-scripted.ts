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
import { readWav } from "./wav-file.ts";
import {
  exchangeCount,
  requestLimit,
  stopCheckMs,
  wording,
} from "./voice-dialogue.values.ts";

const CHUNK_MS = 100;

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const realClock: Clock = {
  now: () => performance.now(),
  sleep: (ms, signal) =>
    sleep(Math.max(0, ms), undefined, { signal }).then(() => undefined),
};

const sameFormat = (a: AudioFormat, b: AudioFormat): boolean =>
  a.encoding === b.encoding &&
  a.sampleRate === b.sampleRate &&
  a.channels === b.channels;

const describeFormat = (format: AudioFormat): string =>
  `${format.encoding}, ${format.sampleRate} Hz, ${format.channels} channels`;

const chunksOf = (
  path: string,
  file: Buffer,
  accepts: readonly AudioFormat[],
): AudioChunk[] => {
  let wav: { format: AudioFormat; data: Buffer };
  try {
    wav = readWav(file);
  } catch (error) {
    throw new Error(`${path}: ${messageOf(error)}`, { cause: error });
  }
  const { format, data } = wav;
  if (!accepts.some((accepted) => sameFormat(accepted, format))) {
    throw new Error(
      `${path}: the transcriber does not accept ${describeFormat(format)}`,
    );
  }
  const bytesPerChunk =
    Math.floor((format.sampleRate * CHUNK_MS) / 1000) *
    format.channels *
    2;
  if (bytesPerChunk < 1) {
    throw new Error(
      `${path}: the format ${describeFormat(format)} gives empty chunks`,
    );
  }
  const chunks: AudioChunk[] = [];
  for (let at = 0; at < data.length; at += bytesPerChunk) {
    chunks.push({
      format,
      data: data.subarray(at, at + bytesPerChunk),
    });
  }
  return chunks;
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
  accepts: readonly AudioFormat[],
): Promise<RecordedUtterance[]> => {
  const lines = parseScript(await readFile(scriptPath, "utf8"));
  return Promise.all(
    lines.map(async ({ wav, at }) => ({
      at,
      audio: chunksOf(wav, await readFile(wav), accepts),
    })),
  );
};

export const runScripted = async (options: {
  scriptPath: string;
  collaborators: DialogueCollaborators;
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

  let code = 0;
  let utterances: RecordedUtterance[] | undefined;
  try {
    utterances = await loadUtterances(
      options.scriptPath,
      options.collaborators.transcriber.accepts,
    );
  } catch (error) {
    err(`failed script: ${messageOf(error)}`);
    code = 1;
  }

  if (utterances !== undefined) {
    try {
      await mkdir(options.outputDir, { recursive: true });
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
