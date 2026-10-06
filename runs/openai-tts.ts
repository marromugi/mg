import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AudioChunk, AudioFormat } from "@mg/voice";
import { createOpenAiSynthesizer } from "@mg/voice";
import { term } from "@mg/term";
import { readSpeechSettings } from "./speech-settings.ts";

const text =
  process.argv[2] ?? "今日はいい天気ですね。散歩に行きましょう。";

const fail = (message: string): never => {
  console.error(term.paint("error", `${term.mark.error} ${message}`));
  return process.exit(1);
};

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

const settings = readSpeechSettings(process.env);
if (!settings.ok) fail(settings.message);
else if (settings.choice.kind !== "openai") {
  fail("SPEECH_BASE_URL is not set");
} else {
  try {
    const synthesizer = createOpenAiSynthesizer(settings.choice);
    const chunks: AudioChunk[] = [];
    for await (const chunk of synthesizer.synthesize(text)) {
      chunks.push(chunk);
    }
    const format = chunks[0].format;
    const data = Buffer.concat(chunks.map((chunk) => chunk.data));
    const wavPath = join(tmpdir(), "openai-tts.wav");
    await writeFile(wavPath, buildWav(data, format));
    console.log(
      `format: ${format.encoding} ${format.sampleRate} Hz ${format.channels} ch`,
    );
    console.log(`bytes: ${data.length}`);
    console.log(`wav: ${wavPath}`);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}
