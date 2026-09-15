import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startRootSpan } from "../otel-span.js";
import { createTraceSdk } from "../otel/sdk.js";
import { JsonlTraceReader } from "./jsonl-reader.js";
import { spans } from "./schema.js";
import { openTraceDb } from "./sqlite.js";
import { SqliteTraceReader } from "./sqlite-reader.js";

describe("SqliteTraceReader", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mg-trace-store-sqlite-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("round-trips a session written by createTraceSdk and matches the JSONL reader's tree", async () => {
    const jsonlPath = join(dir, "spans.jsonl");
    const sqlitePath = join(dir, "spans.db");

    const sdk = await createTraceSdk({
      jsonlPath,
      sqlitePath,
      sessionId: "session-1",
      serviceName: "svc",
    });
    const root = startRootSpan(sdk.tracer, "root");
    root.addEvent("did-something", { count: 1 });
    const child = root.startSpan("child");
    child.end();
    root.end();
    await sdk.shutdown();

    const jsonlTree = await new JsonlTraceReader(jsonlPath).readSession(
      "session-1",
    );

    const db = await openTraceDb(sqlitePath);
    const sqliteReader = new SqliteTraceReader(db);
    const sqliteTree = await sqliteReader.readSession("session-1");

    expect(sqliteTree?.traces).toHaveLength(1);
    expect(sqliteTree?.traces[0]?.root.name).toBe("root");
    expect(sqliteTree?.traces[0]?.root.children).toHaveLength(1);
    expect(sqliteTree?.traces[0]?.root.children[0]?.name).toBe("child");
    expect(sqliteTree).toEqual(jsonlTree);

    db.$client.close();
  });

  it("returns undefined for a session that is not in the database", async () => {
    const sqlitePath = join(dir, "spans.db");
    const sdk = await createTraceSdk({
      sqlitePath,
      sessionId: "session-1",
    });
    const root = startRootSpan(sdk.tracer, "root");
    root.end();
    await sdk.shutdown();

    const db = await openTraceDb(sqlitePath);
    const reader = new SqliteTraceReader(db);
    expect(await reader.readSession("no-such-session")).toBeUndefined();
    db.$client.close();
  });

  it("lists sessions from two different SDKs newest first", async () => {
    const sqlitePath = join(dir, "spans.db");

    const sdkOld = await createTraceSdk({
      sqlitePath,
      sessionId: "session-old",
      serviceName: "svc",
    });
    const rootOld = startRootSpan(sdkOld.tracer, "root");
    rootOld.end();
    await sdkOld.shutdown();

    await new Promise((resolve) => setTimeout(resolve, 5));

    const sdkNew = await createTraceSdk({
      sqlitePath,
      sessionId: "session-new",
      serviceName: "svc",
    });
    const rootNew = startRootSpan(sdkNew.tracer, "root");
    rootNew.end();
    await sdkNew.shutdown();

    const db = await openTraceDb(sqlitePath);
    const reader = new SqliteTraceReader(db);
    const summaries = await reader.listSessions();

    expect(summaries.map((summary) => summary.sessionId)).toEqual([
      "session-new",
      "session-old",
    ]);
    expect(summaries[0]?.serviceName).toBe("svc");
    expect(summaries[0]?.traceCount).toBe(1);

    db.$client.close();
  });

  it("treats an empty database as having no sessions", async () => {
    const sqlitePath = join(dir, "spans.db");
    const db = await openTraceDb(sqlitePath);
    const reader = new SqliteTraceReader(db);

    expect(await reader.listSessions()).toEqual([]);
    expect(await reader.readSession("session-1")).toBeUndefined();

    db.$client.close();
  });

  it("keeps traceCount from listSessions in sync with traces.length from readSession, including an orphan", async () => {
    const sqlitePath = join(dir, "spans.db");
    const db = await openTraceDb(sqlitePath);

    await db.insert(spans).values([
      {
        sessionId: "session-1",
        serviceName: "svc",
        traceId: "t1",
        spanId: "orphan",
        parentSpanId: "missing-parent",
        name: "orphan",
        startTime: "2026-01-01T00:00:00.000Z",
        endTime: "2026-01-01T00:00:01.000Z",
        attributes: "{}",
        events: "[]",
        statusCode: 0,
      },
      {
        sessionId: "session-1",
        serviceName: "svc",
        traceId: "t1",
        spanId: "root",
        parentSpanId: null,
        name: "root",
        startTime: "2026-01-01T00:00:02.000Z",
        endTime: "2026-01-01T00:00:03.000Z",
        attributes: "{}",
        events: "[]",
        statusCode: 0,
      },
    ]);

    const reader = new SqliteTraceReader(db);
    const summaries = await reader.listSessions();
    const tree = await reader.readSession("session-1");

    expect(tree?.traces).toHaveLength(2);
    expect(summaries[0]?.traceCount).toBe(tree?.traces.length);

    db.$client.close();
  });
});
