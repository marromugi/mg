import type { Server } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { serve } from "@hono/node-server";
import { openSqliteConversationStore } from "@mg/conversation/sqlite";
import {
  createOllamaProvider,
  createOpenRouterProvider,
  type Provider,
} from "@mg/core";
import { createHost, type Client } from "@mg/host";
import { openSqliteReplyLog } from "@mg/host/sqlite";
import { openSqliteInboxStore } from "@mg/inbox/sqlite";
import { defineRun } from "@mg/runner";

const usage =
  "Usage: node --env-file-if-exists=.env runs/host-server.ts --tokens <file> [--port <port>] [--data-dir <dir>]\n" +
  'The token file is JSON: [{ "name": "phone", "token": "..." }].\n' +
  "HOST_PROVIDER is ollama (default) or openrouter; HOST_MODEL names the model.";

const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};

const { values } = parseArgs({
  options: {
    port: { type: "string", default: "8787" },
    "data-dir": { type: "string", default: ".mg/host" },
    tokens: { type: "string" },
  },
});
if (values.tokens === undefined) {
  console.error(usage);
  process.exit(2);
}
const port = Number(values.port);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  fail(`--port must be a port number, got "${values.port}".`);
}
const dataDir = values["data-dir"];

const readClients = async (path: string): Promise<Client[]> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    return fail(
      `Cannot read the token file "${path}": ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const valid =
    Array.isArray(parsed) &&
    parsed.every(
      (entry) =>
        typeof entry?.name === "string" &&
        typeof entry?.token === "string",
    );
  return valid
    ? (parsed as Client[])
    : fail(
        `The token file "${path}" must be a JSON array of { "name", "token" }.`,
      );
};

const buildProvider = (): { provider: Provider; model: string } => {
  const kind = process.env.HOST_PROVIDER ?? "ollama";
  const model = process.env.HOST_MODEL;
  if (kind === "ollama") {
    return {
      provider: createOllamaProvider(),
      model: model ?? "gemma4:e4b",
    };
  }
  if (kind === "openrouter") {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (apiKey === undefined || model === undefined) {
      return fail(
        "HOST_PROVIDER=openrouter needs OPENROUTER_API_KEY and HOST_MODEL.",
      );
    }
    return { provider: createOpenRouterProvider({ apiKey }), model };
  }
  return fail(
    `HOST_PROVIDER must be "ollama" or "openrouter", got "${kind}".`,
  );
};

const clients = await readClients(values.tokens);
const { provider, model } = buildProvider();

const conversations = await openSqliteConversationStore(
  join(dataDir, "conversations.db"),
).catch((error: unknown) =>
  fail(
    `Cannot open the data folder "${dataDir}": ${
      error instanceof Error ? error.message : String(error)
    }`,
  ),
);
const inbox = await openSqliteInboxStore(join(dataDir, "inbox.db"));
const replies = await openSqliteReplyLog(join(dataDir, "replies.db"));

const host = createHost({
  agent: ({ tools, gate }) =>
    defineRun({
      name: "host",
      provider,
      harness: { kind: "loop", model, maxTurns: 10 },
      tools,
      gate,
    }),
  instruction: (now) =>
    `The time now is ${new Date(now).toISOString()}. ` +
    "You can get back to this conversation later with the later tool: " +
    "give it a number of seconds and a note to yourself. " +
    "When the time comes you read the note and answer it. " +
    "Use it whenever the user asks you to reply or do something after a delay.",
  onRefusal: (tool) => {
    console.log(`gate refused ${tool ?? "a request"}`);
  },
  conversations,
  inbox,
  replies,
  clients,
});
await host.start();

const server = serve(
  { fetch: host.app.fetch, hostname: "127.0.0.1", port },
  (info) => {
    console.log(`listening on http://127.0.0.1:${info.port}`);
  },
);
server.on("error", (error) => {
  fail(`Cannot listen on 127.0.0.1:${port}: ${error.message}`);
});

let stopping = false;
const stop = async (): Promise<void> => {
  if (stopping) {
    return;
  }
  stopping = true;
  await host.close().catch((error: unknown) => {
    console.error(error);
  });
  (server as Server).closeAllConnections();
  server.close();
  await Promise.allSettled([
    conversations.close(),
    inbox.close(),
    replies.close(),
  ]);
  process.exit(0);
};
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
