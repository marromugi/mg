import type { ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createHostClient,
  type HostClient,
  type ReplyRecord,
} from "@mg/host-client";
import {
  freePort,
  startServer,
  stopAllServers,
  stopChild,
} from "./host-process.ts";

const failures: string[] = [];
const expectThat = (ok: boolean, message: string): void => {
  console.log(`${ok ? "ok  " : "FAIL"} ${message}`);
  if (!ok) {
    failures.push(message);
  }
};

const TIMEOUT_MS = 180_000;

/**
 * Handles records the way a service client does: keeps the cursor
 * after each one. Stops once `done` is satisfied, or on timeout.
 */
const readUntil = async (
  client: HostClient,
  options: {
    after: number;
    conversations?: string[];
    prefix?: string;
  },
  done: (handled: ReplyRecord[]) => boolean,
  idleMs?: number,
): Promise<{ handled: ReplyRecord[]; cursor: number }> => {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  let idle: NodeJS.Timeout | undefined;
  const restartIdle = (): void => {
    if (idleMs !== undefined) {
      clearTimeout(idle);
      idle = setTimeout(() => abort.abort(), idleMs);
    }
  };
  restartIdle();
  const handled: ReplyRecord[] = [];
  let cursor = options.after;
  try {
    for await (const record of client.replies({
      ...options,
      signal: abort.signal,
    })) {
      handled.push(record);
      cursor = record.cursor;
      restartIdle();
      if (done(handled)) {
        break;
      }
    }
  } finally {
    clearTimeout(timer);
    clearTimeout(idle);
  }
  return { handled, cursor };
};

const answered = (handled: ReplyRecord[], inputId: string): boolean =>
  handled.some((r) => r.inputId === inputId && r.kind !== "scheduled");

const dir = await mkdtemp(join(tmpdir(), "host-client-check-"));
try {
  const token = randomBytes(16).toString("hex");
  const tokensFile = join(dir, "tokens.json");
  await writeFile(
    tokensFile,
    JSON.stringify([{ name: "check", token }]),
  );
  const dataDir = join(dir, "data");
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const client = createHostClient({ url, token });
  const ask = (conversation: string, word: string) =>
    client.send(conversation, `Answer with only the word: ${word}`);

  let server: ChildProcess = await startServer(
    port,
    dataDir,
    tokensFile,
  );

  // V1: read only the conversations named, by prefix.
  const sentA = await ask("discord:a", "alpha");
  const sentB = await ask("other:b", "beta");
  const other = await readUntil(
    client,
    { after: 0, conversations: ["other:b"] },
    (handled) => answered(handled, sentB.id),
  );
  const byPrefix = await readUntil(
    client,
    { after: 0, prefix: "discord:" },
    (handled) => answered(handled, sentA.id),
  );
  console.log(`other:b replies: ${JSON.stringify(other.handled)}`);
  console.log(`discord: replies: ${JSON.stringify(byPrefix.handled)}`);
  expectThat(
    byPrefix.handled.length > 0 &&
      byPrefix.handled.every((r) => r.conversationId === "discord:a"),
    "every reply read with prefix=discord: is from discord:a",
  );
  expectThat(
    byPrefix.handled.some(
      (r) => r.inputId === sentA.id && r.kind === "reply",
    ),
    "one of them answers the input sent to discord:a",
  );
  expectThat(
    other.handled.some((r) => r.inputId === sentB.id) &&
      !byPrefix.handled.some((r) => r.conversationId === "other:b"),
    "other:b was answered and none of its replies came with the prefix",
  );

  // V2: a reader stops and a new one starts from the cursor kept.
  const handledCursors: number[] = [];
  const sentIds = [sentA.id];
  const first = await readUntil(
    client,
    { after: 0, conversations: ["discord:a"] },
    (handled) => answered(handled, sentA.id),
  );
  handledCursors.push(...first.handled.map((r) => r.cursor));
  console.log(
    `first reader cursors: ${JSON.stringify(handledCursors)}`,
  );

  const second = await ask("discord:a", "gamma");
  const third = await ask("discord:a", "delta");
  sentIds.push(second.id, third.id);
  const next = await readUntil(
    client,
    { after: first.cursor, conversations: ["discord:a"] },
    (handled) =>
      answered(handled, second.id) && answered(handled, third.id),
  );
  handledCursors.push(...next.handled.map((r) => r.cursor));
  console.log(
    `second reader cursors: ${JSON.stringify(next.handled.map((r) => r.cursor))}`,
  );

  // V2: the server stops and starts again while a reader iterates.
  let target: string | undefined;
  const reading = readUntil(
    client,
    { after: next.cursor, conversations: ["discord:a"] },
    (handled) => target !== undefined && answered(handled, target),
  );
  await new Promise((resolve) => setTimeout(resolve, 1000));
  await stopChild(server);
  server = await startServer(port, dataDir, tokensFile);
  const afterRestart = await ask("discord:a", "epsilon");
  sentIds.push(afterRestart.id);
  target = afterRestart.id;
  const restarted = await reading;
  handledCursors.push(...restarted.handled.map((r) => r.cursor));
  console.log(
    `reader across the restart cursors: ${JSON.stringify(restarted.handled.map((r) => r.cursor))}`,
  );
  console.log(`cursors handled: ${JSON.stringify(handledCursors)}`);

  const everything = await readUntil(
    client,
    { after: 0, conversations: ["discord:a"] },
    () => false,
    3000,
  );
  const written = everything.handled.map((r) => r.cursor);
  expectThat(
    sentIds.every((id) =>
      everything.handled.some(
        (r) => r.inputId === id && r.kind === "reply",
      ),
    ) && written.length >= sentIds.length,
    "every input sent to discord:a was answered in the log",
  );
  expectThat(
    JSON.stringify(handledCursors) === JSON.stringify(written),
    "every reply of discord:a was handled exactly once, in increasing cursor order",
  );
} catch (error) {
  console.error(error);
  failures.push(error instanceof Error ? error.message : String(error));
} finally {
  await stopAllServers();
  await rm(dir, { recursive: true, force: true });
}
process.exitCode = failures.length === 0 ? 0 : 1;
