import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openTraceDb } from "./sqlite.js";

describe("openTraceDb", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mg-trace-store-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates the spans table in a fresh temp file", async () => {
    const path = join(dir, "spans.db");
    const db = await openTraceDb(path);

    const tables = await db.all<{ name: string }>(
      sql`select name from sqlite_master where type = 'table' and name = 'spans'`,
    );

    expect(tables).toEqual([{ name: "spans" }]);

    await db.$client.close();
  });

  it("opens an in-memory database for tests", async () => {
    const db = await openTraceDb(":memory:");

    const tables = await db.all<{ name: string }>(
      sql`select name from sqlite_master where type = 'table' and name = 'spans'`,
    );

    expect(tables).toEqual([{ name: "spans" }]);

    await db.$client.close();
  });
});
