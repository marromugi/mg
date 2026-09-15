import { parseArgs } from "node:util";
import { openTraceDb, SqliteTraceReader } from "@mg/trace/store";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";

const DEFAULT_PORT = 3210;
const MAX_PORT = 65536;

// `pnpm run start -- --db x` forwards a literal leading "--", which node:util's
// parseArgs otherwise treats as "end of options" and turns --db into a positional.
const rawArgs = process.argv.slice(2);
const args = rawArgs[0] === "--" ? rawArgs.slice(1) : rawArgs;

const { values } = parseArgs({
  args,
  allowPositionals: true,
  options: {
    db: { type: "string" },
    port: { type: "string" },
  },
});

if (values.db === undefined) {
  console.error("Missing required option: --db <path>");
  process.exit(1);
}

const port = values.port !== undefined ? Number(values.port) : DEFAULT_PORT;

if (!Number.isInteger(port) || port <= 0 || port >= MAX_PORT) {
  console.error(`Invalid --port value: ${values.port}`);
  process.exit(1);
}

const db = await openTraceDb(values.db);
const reader = new SqliteTraceReader(db);
const app = createApp(reader);

serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, (info) => {
  console.log(`trace-ui listening on http://localhost:${info.port}`);
});
