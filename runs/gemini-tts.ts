import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AudioChunk, AudioFormat } from "@mg/voice";
import { createGeminiSynthesizer } from "@mg/voice";
import { term } from "@mg/term";

const apiKey = process.env.GEMINI_API_KEY;
if (apiKey === undefined) throw new Error("GEMINI_API_KEY is not set");

const text =
  process.argv[2] ?? "今日はいい天気ですね。散歩に行きましょう。";

type Call = { label: string; language?: string };

// speakingRate の欄は確かめた API になく、渡すと作る時点でエラーになる
// ため、この呼び出しは持ちません。
const calls: Call[] = [
  { label: "default" },
  { label: "language=ja-JP", language: "ja-JP" },
];

const buildWav = (data: Buffer, format: AudioFormat): Buffer => {
  const header = Buffer.alloc(44);
  const byteRate = format.sampleRate * format.channels * 2;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(format.channels, 22);
  header.writeUInt32LE(format.sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(format.channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
};

const meanAbsDiff = (data: Buffer, littleEndian: boolean): number => {
  const sampleCount = Math.floor(data.length / 2);
  if (sampleCount < 2) return 0;
  const samples: number[] = [];
  for (let i = 0; i < sampleCount; i++) {
    samples.push(
      littleEndian ? data.readInt16LE(i * 2) : data.readInt16BE(i * 2),
    );
  }
  let total = 0;
  for (let i = 1; i < samples.length; i++) {
    total += Math.abs(samples[i] - samples[i - 1]);
  }
  return total / (samples.length - 1);
};

let failed = false;

for (const [index, call] of calls.entries()) {
  console.log(
    term.paint("strong", `${term.mark.strong} call: ${call.label}`),
  );

  try {
    const synthesizer = createGeminiSynthesizer({
      apiKey,
      voice: "Kore",
      ...(call.language !== undefined && { language: call.language }),
    });

    const chunks: AudioChunk[] = [];
    const start = performance.now();
    let firstChunkMs: number | undefined;

    for await (const chunk of synthesizer.synthesize(text)) {
      firstChunkMs ??= performance.now() - start;
      chunks.push(chunk);
    }

    if (chunks.length === 0) throw new Error("no audio received");

    const format = chunks[0].format;
    const data = Buffer.concat(
      chunks.map((chunk) => Buffer.from(chunk.data)),
    );
    const durationSeconds = data.length / 2 / format.sampleRate;
    const le = meanAbsDiff(data, true);
    const be = meanAbsDiff(data, false);
    const wavPath = join(tmpdir(), `gemini-tts-${index + 1}.wav`);
    await writeFile(wavPath, buildWav(data, format));

    console.log(`  first-chunk ms: ${(firstChunkMs ?? 0).toFixed(1)}`);
    console.log(`  chunks: ${chunks.length}`);
    console.log(
      `  format: ${format.encoding} ${format.sampleRate}Hz ${format.channels}ch`,
    );
    console.log(`  total bytes: ${data.length}`);
    console.log(`  duration: ${durationSeconds.toFixed(2)}s`);
    console.log(
      `  mean-abs-diff le=${le.toFixed(2)} be=${be.toFixed(2)}`,
    );
    console.log(`  wav: ${wavPath}`);
  } catch (error) {
    failed = true;
    const message =
      error instanceof Error ? error.message : String(error);
    console.error(
      term.paint("error", `  ${term.mark.error} ${message}`),
    );
  }
}

if (failed) process.exitCode = 1;
