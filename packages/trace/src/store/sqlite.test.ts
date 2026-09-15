import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openTraceDb } from "./sqlite.js";

const execFileAsync = promisify(execFile);

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

    db.$client.close();
  });

  it("opens an in-memory database for tests", async () => {
    const db = await openTraceDb(":memory:");

    const tables = await db.all<{ name: string }>(
      sql`select name from sqlite_master where type = 'table' and name = 'spans'`,
    );

    expect(tables).toEqual([{ name: "spans" }]);

    db.$client.close();
  });

  it("creates missing parent folders before opening the file", async () => {
    const path = join(dir, "nested", "deeper", "spans.db");
    const db = await openTraceDb(path);

    const tables = await db.all<{ name: string }>(
      sql`select name from sqlite_master where type = 'table' and name = 'spans'`,
    );

    expect(tables).toEqual([{ name: "spans" }]);

    db.$client.close();
  });

  it("opens a path whose folder name contains a #", async () => {
    const path = join(dir, "a #b", "spans.db");
    const db = await openTraceDb(path);

    const tables = await db.all<{ name: string }>(
      sql`select name from sqlite_master where type = 'table' and name = 'spans'`,
    );

    expect(tables).toEqual([{ name: "spans" }]);

    db.$client.close();
  });

  it("opens the same new path from 5 concurrent calls in-process without failing", async () => {
    const path = join(dir, "concurrent.db");

    const dbs = await Promise.all(
      Array.from({ length: 5 }, () => openTraceDb(path)),
    );

    const tables = await dbs[0]?.all<{ name: string }>(
      sql`select name from sqlite_master where type = 'table' and name = 'spans'`,
    );
    expect(tables).toEqual([{ name: "spans" }]);

    for (const db of dbs) {
      db.$client.close();
    }
  });

  const distSqlitePath = fileURLToPath(
    new URL("../../dist/store/sqlite.js", import.meta.url),
  );

  it.skipIf(!existsSync(distSqlitePath))(
    "opens the same new path from 3 concurrent child processes without failing",
    async () => {
      const path = join(dir, "concurrent-processes.db");
      const script = `
        import { openTraceDb } from ${JSON.stringify(distSqlitePath)};
        const db = await openTraceDb(${JSON.stringify(path)});
        db.$client.close();
        console.log("ok");
      `;

      const results = await Promise.all(
        Array.from({ length: 3 }, () =>
          execFileAsync(
            process.execPath,
            ["--input-type=module", "-e", script],
            {
              timeout: 10_000,
            },
          ),
        ),
      );

      for (const { stdout } of results) {
        expect(stdout.trim()).toBe("ok");
      }

      const db = await openTraceDb(path);
      const tables = await db.all<{ name: string }>(
        sql`select name from sqlite_master where type = 'table' and name = 'spans'`,
      );
      expect(tables).toEqual([{ name: "spans" }]);
      db.$client.close();
    },
  );
});
