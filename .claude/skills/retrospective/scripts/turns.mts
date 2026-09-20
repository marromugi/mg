// Reads one day of Claude Code transcripts and returns what the developer
// said, each paired with the agent's reply it responds to: the last text the
// agent wrote before it. Answers given through a question tool are included.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type Turn = {
  id: string;
  time: string;
  iso: string;
  skill: string;
  interrupted: boolean;
  agent: string;
  kind: "typed" | "answer";
  text: string;
};

export type Session = { id: string; title: string; turns: Turn[] };

export type ReadTurnsOptions = {
  dir: string;
  date: string;
  exclude?: string;
};

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringAt = (record: Json, key: string): string | undefined => {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
};

const recordAt = (record: Json, key: string): Json | undefined => {
  const value = record[key];
  return isRecord(value) ? value : undefined;
};

const recordsAt = (record: Json, key: string): Json[] => {
  const value = record[key];
  return Array.isArray(value) ? value.filter(isRecord) : [];
};

export const localDate = (iso: string): string => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const localTime = (iso: string): string =>
  new Date(iso).toTimeString().slice(0, 5);

const parseLine = (line: string): Json | undefined => {
  try {
    const parsed: unknown = JSON.parse(line);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

// A message's content is either a string or a list of blocks. Returns the
// text only when every block is text, so tool results are never mistaken
// for something the developer typed.
const messageText = (entry: Json): string | undefined => {
  const message = recordAt(entry, "message");
  if (message === undefined) return undefined;
  const content = message["content"];
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  const texts = content.map((block) =>
    isRecord(block) && block["type"] === "text"
      ? stringAt(block, "text")
      : undefined,
  );
  return texts.every((text) => text !== undefined)
    ? texts.join("\n")
    : undefined;
};

const agentTexts = (entry: Json): string[] => {
  const message = recordAt(entry, "message");
  if (message === undefined) return [];
  return recordsAt(message, "content")
    .filter((block) => block["type"] === "text")
    .map((block) => (stringAt(block, "text") ?? "").trim())
    .filter((text) => text !== "");
};

// Slash commands arrive wrapped in tags; keep the command and its arguments.
const cleanUserText = (text: string): string => {
  const name = text.match(/<command-name>([^<]*)<\/command-name>/);
  if (name) {
    const args = text.match(/<command-args>([\s\S]*?)<\/command-args>/);
    return `${name[1] ?? ""} ${args?.[1] ?? ""}`.trim();
  }
  return text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
    .trim();
};

const NOT_TYPED = /^<(task-notification|local-command|bash-|ci-monitor)/;

const typedText = (entry: Json): string | undefined => {
  if (entry["isSidechain"] === true || entry["isMeta"] === true) {
    return undefined;
  }
  const origin = recordAt(entry, "origin");
  if (origin !== undefined && origin["kind"] !== "human") return undefined;
  const text = messageText(entry);
  if (text === undefined || NOT_TYPED.test(text)) return undefined;
  const cleaned = cleanUserText(text);
  return cleaned === "" ? undefined : cleaned;
};

const loadedSkill = (entry: Json): string | undefined => {
  const text = messageText(entry);
  return text?.match(
    /^Base directory for this skill: .*\/([^/\s]+)\s/,
  )?.[1];
};

const answerText = (entry: Json): string | undefined => {
  const result = recordAt(entry, "toolUseResult");
  const answers = result && recordAt(result, "answers");
  if (result === undefined || answers === undefined) return undefined;
  return recordsAt(result, "questions")
    .map((question) => {
      const asked = stringAt(question, "question") ?? "";
      const labels = recordsAt(question, "options").map(
        (option) => stringAt(option, "label") ?? "",
      );
      const answer = stringAt(answers, asked) ?? "(no answer)";
      const offered = labels.includes(answer);
      return [
        `Q: ${asked}`,
        `   options: ${labels.join(" / ")}`,
        `   answer${offered ? "" : " (not among the options)"}: ${answer}`,
      ].join("\n");
    })
    .join("\n");
};

const readSession = (
  path: string,
  id: string,
  date: string,
): Session => {
  let title = "";
  let agent: string[] = [];
  let skill = "";
  let interrupted = false;
  const turns: Turn[] = [];

  for (const line of readFileSync(path, "utf8").split("\n")) {
    const entry = line === "" ? undefined : parseLine(line);
    if (entry === undefined) continue;

    if (entry["type"] === "custom-title") {
      title = stringAt(entry, "customTitle") ?? title;
      continue;
    }
    if (entry["type"] === "assistant") {
      if (entry["isSidechain"] !== true) agent.push(...agentTexts(entry));
      continue;
    }
    const iso = stringAt(entry, "timestamp");
    if (entry["type"] !== "user" || iso === undefined) continue;

    const loaded = loadedSkill(entry);
    if (loaded !== undefined) {
      skill = loaded;
      continue;
    }
    const answer = answerText(entry);
    const text = answer ?? typedText(entry);
    if (text === undefined) continue;
    if (text.startsWith("[Request interrupted")) {
      interrupted = true;
      continue;
    }
    if (localDate(iso) === date) {
      turns.push({
        id: `${id.slice(0, 8)}#${turns.length + 1}`,
        time: localTime(iso),
        iso,
        skill,
        interrupted,
        agent: agent.at(-1) ?? "",
        kind: answer === undefined ? "typed" : "answer",
        text,
      });
    }
    agent = [];
    interrupted = false;
  }
  return { id, title, turns };
};

export const readTurns = (options: ReadTurnsOptions): Session[] =>
  readdirSync(options.dir)
    .filter((file) => file.endsWith(".jsonl"))
    .map((file) => ({ file, id: file.replace(/\.jsonl$/, "") }))
    .filter(({ id }) => id !== options.exclude)
    .map(({ file, id }) =>
      readSession(join(options.dir, file), id, options.date),
    )
    .filter((session) => session.turns.length > 0)
    .sort((a, b) => (a.turns[0]?.iso ?? "").localeCompare(b.turns[0]?.iso ?? ""));
