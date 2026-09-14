import { promises as fs } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

export type TraceDb = ReturnType<typeof drizzle>;

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

export const openTraceDb = async (path: string): Promise<TraceDb> => {
  const url = path === ":memory:" ? "file::memory:" : pathToFileURL(resolve(path)).href;
  if (path !== ":memory:") {
    await fs.mkdir(dirname(path), { recursive: true });
  }
  const client = createClient({ url });
  const db = drizzle(client);
  await migrate(db, { migrationsFolder });
  return db;
};
