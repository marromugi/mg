import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Reply = {
  cursor: number;
  conversationId: string;
  inputId: string;
  kind: "reply" | "failed";
  text?: string;
  reason?: string;
};

const children = new Set<ChildProcess>();
const sent: string[] = [];
const failures: string[] = [];
const expectThat = (ok: boolean, message: string): void => {
  console.log(`${ok ? "ok  " : "FAIL"} ${message}`);
  if (!ok) {
    failures.push(message);
  }
};
const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() =>
        typeof address === "object" && address !== null
          ? resolve(address.port)
          : reject(new Error("no port")),
      );
    });
  });

const stopChild = (child: ChildProcess): Promise<void> =>
  new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    child.once("exit", () => resolve());
    child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), 10_000).unref();
  });

const startServer = (
  port: number,
  dataDir: string,
  tokensFile: string,
): Promise<ChildProcess> =>
  new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--env-file-if-exists=.env",
        "runs/host-server.ts",
        "--port",
        String(port),
        "--data-dir",
        dataDir,
        "--tokens",
        tokensFile,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    children.add(child);
    let output = "";
    const onData = (chunk: Buffer): void => {
      const text = chunk.toString();
      sent.push(text);
      output += text;
      if (output.includes("listening on")) {
        resolve(child);
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("exit", (code) =>
      reject(
        new Error(
          `the server exited with ${code} before listening:\n${output}`,
        ),
      ),
    );
  });

const post = async (
  base: string,
  conversation: string,
  body: unknown,
  token?: string,
): Promise<{ status: number; body: string }> => {
  const response = await fetch(
    `${base}/conversations/${conversation}/inputs`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token === undefined
          ? {}
          : { authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify(body),
    },
  );
  const text = await response.text();
  sent.push(text);
  return { status: response.status, body: text };
};

// Reads the reply stream from the start until `done` is satisfied.
const readReplies = async (
  base: string,
  token: string,
  done: (replies: Reply[]) => boolean,
  timeoutMs: number,
): Promise<{ replies: Reply[]; seenAt: Map<number, number> }> => {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  const replies: Reply[] = [];
  const seenAt = new Map<number, number>();
  try {
    const response = await fetch(`${base}/replies?after=0`, {
      headers: { authorization: `Bearer ${token}` },
      signal: abort.signal,
    });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (!done(replies)) {
      const { done: ended, value } = await reader.read();
      if (ended) {
        break;
      }
      const chunk = decoder.decode(value, { stream: true });
      sent.push(chunk);
      buffer += chunk;
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const reply = JSON.parse(buffer.slice(0, newline)) as Reply;
        replies.push(reply);
        seenAt.set(reply.cursor, Date.now());
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
      }
    }
    await reader.cancel();
  } catch (error) {
    if (!abort.signal.aborted) {
      throw error;
    }
  } finally {
    clearTimeout(timer);
  }
  return { replies, seenAt };
};

const dir = await mkdtemp(join(tmpdir(), "host-check-"));
try {
  const token = randomBytes(16).toString("hex");
  const tokensFile = join(dir, "tokens.json");
  await writeFile(
    tokensFile,
    JSON.stringify([{ name: "check", token }]),
  );
  const dataDir = join(dir, "data");
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;

  // V3: input with no token or a wrong token is refused.
  let server = await startServer(port, dataDir, tokensFile);
  const none = await post(base, "denied", { text: "hello" });
  const wrong = await post(base, "denied", { text: "hello" }, "wrong");
  expectThat(
    none.status === 401 && wrong.status === 401,
    `no token and a wrong token both get 401 (${none.status}, ${wrong.status})`,
  );
  console.log(`401 body: ${none.body}`);

  // V2: two inputs to one conversation come back in the order sent.
  await post(
    base,
    "pair",
    { text: "Answer with only the word: first" },
    token,
  );
  await post(
    base,
    "pair",
    { text: "Answer with only the word: second" },
    token,
  );

  const beforeStop = await readReplies(
    base,
    token,
    (replies) =>
      replies.filter((r) => r.conversationId === "pair").length >= 2,
    120_000,
  );
  const pair = beforeStop.replies.filter(
    (r) => r.conversationId === "pair",
  );
  console.log(
    `pair replies: ${JSON.stringify(pair.map((r) => r.text))}`,
  );
  expectThat(
    pair.length === 2 &&
      pair[0].cursor < pair[1].cursor &&
      /first/i.test(pair[0].text ?? "") &&
      /second/i.test(pair[1].text ?? ""),
    "two replies for the pair conversation, in the order sent",
  );

  // V1: input due in 5 seconds, with the server stopped before then.
  const dueAt = Date.now() + 5000;
  const late = await post(
    base,
    "late",
    { text: "Answer with only the word: late", dueAt },
    token,
  );
  const lateId = (JSON.parse(late.body) as { id: string }).id;
  await stopChild(server);
  expectThat(
    Date.now() < dueAt,
    "the server stopped before the due time",
  );

  server = await startServer(port, dataDir, tokensFile);
  const restarted = await readReplies(
    base,
    token,
    (replies) => replies.some((r) => r.inputId === lateId),
    120_000,
  );
  const lateReplies = restarted.replies.filter(
    (r) => r.inputId === lateId,
  );
  const lateReply = lateReplies[0];
  console.log(`late reply: ${JSON.stringify(lateReply)}`);
  expectThat(
    lateReplies.length === 1 && lateReply.kind === "reply",
    "one reply for the late input, written after the restart",
  );
  expectThat(
    lateReply !== undefined &&
      restarted.seenAt.get(lateReply.cursor)! >= dueAt,
    "the late reply arrived at or after its due time",
  );
  expectThat(
    !restarted.replies.some((r) => r.conversationId === "denied"),
    "nothing was written for the refused input",
  );
  await stopChild(server);

  // V3: nothing the server sent contains an LLM key.
  const keys = Object.entries(process.env).filter(
    ([name, value]) =>
      name.endsWith("_API_KEY") && (value ?? "") !== "",
  );
  const everything = sent.join("");
  const leaked = keys.filter(([, value]) =>
    everything.includes(value!),
  );
  console.log(
    `scanned ${everything.length} bytes for ${keys.length} key value(s)`,
  );
  expectThat(
    leaked.length === 0,
    "no *_API_KEY value was sent to a client",
  );
} finally {
  await Promise.all([...children].map(stopChild));
  await rm(dir, { recursive: true, force: true });
}
process.exitCode = failures.length === 0 ? 0 : 1;
