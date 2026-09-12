import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

export type TraceDb = ReturnType<typeof drizzle>;

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

export const openTraceDb = async (path: string): Promise<TraceDb> => {
  const client = createClient({ url: `file:${path}` });
  const db = drizzle(client);
  await migrate(db, { migrationsFolder });
  return db;
};
