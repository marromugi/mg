import { parseArgs } from "node:util";
import { openTraceDb, SqliteTraceReader } from "@mg/trace/store";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";

const DEFAULT_PORT = 3210;

const { values } = parseArgs({
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

const db = await openTraceDb(values.db);
const reader = new SqliteTraceReader(db);
const app = createApp(reader);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`trace-ui listening on http://localhost:${info.port}`);
});
