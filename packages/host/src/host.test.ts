import { createMemoryConversationStore } from "@mg/conversation";
import type { GenerateRequest, Provider } from "@mg/core";
import { createMemoryInboxStore, type Clock } from "@mg/inbox";
import { afterEach, describe, expect, test } from "vitest";
import { createHost, type Host } from "./host.js";
import { createMemoryReplyLog } from "./memory.js";
import type { ReplyRecord } from "./types.js";

const token = "secret-token-1";
const auth = { authorization: `Bearer ${token}` };

const fakeClock = (): Clock & { advance(ms: number): void } => {
  let now = 1000;
  let timer: { at: number; fn: () => void } | undefined;
  return {
    now: () => now,
    setTimer: (fn, ms) => {
      const entry = { at: now + ms, fn };
      timer = entry;
      return () => {
        if (timer === entry) {
          timer = undefined;
        }
      };
    },
    advance(ms) {
      now += ms;
      const due = timer;
      if (due !== undefined && due.at <= now) {
        timer = undefined;
        due.fn();
      }
    },
  };
};

const echoProvider = (
  fail?: Error,
): { provider: Provider; calls: GenerateRequest[] } => {
  const calls: GenerateRequest[] = [];
  const provider: Provider = {
    toolForcing: true,
    generate: async (request) => {
      calls.push(request);
      if (fail !== undefined) {
        throw fail;
      }
      const last = request.messages[request.messages.length - 1];
      const heard =
        last.role === "user" && typeof last.content === "string"
          ? last.content
          : "?";
      return {
        parts: [{ type: "text", text: `heard: ${heard}` }],
        finishReason: "stop",
      };
    },
    stream: () => {
      throw new Error("stream is not scripted");
    },
  };
  return { provider, calls };
};

const open = (options?: { fail?: Error }) => {
  const { provider, calls } = echoProvider(options?.fail);
  const clock = fakeClock();
  const replies = createMemoryReplyLog();
  const errors: Error[] = [];
  const host = createHost({
    agent: {
      name: "test",
      provider,
      harness: { kind: "loop", model: "m", maxTurns: 3, stream: false },
    },
    conversations: createMemoryConversationStore(),
    inbox: createMemoryInboxStore(),
    replies,
    clients: [{ name: "phone", token }],
    clock,
    onError: (error) => errors.push(error),
  });
  return { host, calls, clock, replies, errors };
};

const send = (
  host: Host,
  conversation: string,
  body: unknown,
  headers: Record<string, string> = auth,
): Promise<Response> =>
  Promise.resolve(
    host.app.request(`/conversations/${conversation}/inputs`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );

const readReplies = async (
  response: Response,
  count: number,
): Promise<ReplyRecord[]> => {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const records: ReplyRecord[] = [];
  let buffer = "";
  while (records.length < count) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      records.push(JSON.parse(buffer.slice(0, newline)) as ReplyRecord);
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
    }
  }
  await reader.cancel();
  return records;
};

const getReplies = (host: Host, query = "") =>
  Promise.resolve(
    host.app.request(`/replies${query}`, { headers: auth }),
  );

let host: Host | undefined;
afterEach(async () => {
  await host?.close();
  host = undefined;
});

describe("the host", () => {
  test("answers 202 with the item id and due time, and the reply follows", async () => {
    const opened = open();
    host = opened.host;
    await host.start();

    const response = await send(host, "talk", { text: "hello" });
    const body = (await response.json()) as {
      id: string;
      dueAt: number;
    };

    expect(response.status).toBe(202);
    expect(body.dueAt).toBe(1000);
    const [reply] = await readReplies(await getReplies(host), 1);
    expect(reply).toEqual({
      cursor: 1,
      conversationId: "talk",
      inputId: body.id,
      kind: "reply",
      text: "heard: hello",
    });
  });

  test("streams a reply written after the read began", async () => {
    const opened = open();
    host = opened.host;
    await host.start();
    const reading = readReplies(await getReplies(host), 1);

    await send(host, "talk", { text: "later" });

    expect((await reading).map((r) => r.kind)).toEqual(["reply"]);
  });

  test("reads only replies after the cursor", async () => {
    const opened = open();
    host = opened.host;
    await host.start();
    await send(host, "talk", { text: "one" });
    await send(host, "talk", { text: "two" });

    const records = await readReplies(
      await getReplies(host, "?after=1"),
      1,
    );

    expect(
      records.map((r) => [r.cursor, r.kind === "reply" && r.text]),
    ).toEqual([[2, "heard: two"]]);
  });

  test("answers two inputs of one conversation in the order sent", async () => {
    const opened = open();
    host = opened.host;
    await host.start();

    await send(host, "talk", { text: "first" });
    await send(host, "talk", { text: "second" });

    const records = await readReplies(await getReplies(host), 2);
    expect(records.map((r) => r.kind === "reply" && r.text)).toEqual([
      "heard: first",
      "heard: second",
    ]);
  });

  test("holds an input until its due time", async () => {
    const opened = open();
    host = opened.host;
    await host.start();

    await send(host, "talk", { text: "wait", dueAt: 6000 });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await opened.replies.read(0, 10)).toEqual([]);
    opened.clock.advance(5000);
    const [reply] = await readReplies(await getReplies(host), 1);
    expect(reply.kind).toBe("reply");
  });

  test("refuses a missing or wrong token before any model call", async () => {
    const opened = open();
    host = opened.host;
    await host.start();

    const none = await send(host, "talk", { text: "hi" }, {});
    const wrong = await send(
      host,
      "talk",
      { text: "hi" },
      {
        authorization: "Bearer nope",
      },
    );
    const read = await host.app.request("/replies");

    expect(none.status).toBe(401);
    expect(await none.json()).toEqual({ error: "unauthorized" });
    expect(wrong.status).toBe(401);
    expect(read.status).toBe(401);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(opened.calls).toEqual([]);
    expect(await opened.replies.read(0, 10)).toEqual([]);
  });

  test("answers 400 and keeps the inbox empty for bad input", async () => {
    const opened = open();
    host = opened.host;
    await host.start();

    const notJson = await host.app.request(
      "/conversations/talk/inputs",
      {
        method: "POST",
        headers: auth,
        body: "{broken",
      },
    );
    const noText = await send(host, "talk", { dueAt: 1 });
    const badDue = await send(host, "talk", {
      text: "x",
      dueAt: "soon",
    });

    expect([notJson.status, noText.status, badDue.status]).toEqual([
      400, 400, 400,
    ]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(opened.calls).toEqual([]);
  });

  test("writes a failed reply naming the error when the run throws", async () => {
    const opened = open({ fail: new Error("model is down") });
    host = opened.host;
    await host.start();

    await send(host, "talk", { text: "hi" });

    const [reply] = await readReplies(await getReplies(host), 1);
    expect(reply).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("model is down"),
    });
  });
});
