import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startRootSpan } from "../otel-span.js";
import { createTraceSdk } from "../otel/sdk.js";
import { JsonlTraceReader } from "./jsonl-reader.js";

describe("JsonlTraceReader", () => {
  let dir: string;
  let jsonlPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mg-trace-store-"));
    jsonlPath = join(dir, "spans.jsonl");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("round-trips a session written by createTraceSdk", async () => {
    const sdk = createTraceSdk({ jsonlPath, sessionId: "session-1", serviceName: "svc" });
    const root = startRootSpan(sdk.tracer, "root");
    const child = root.startSpan("child");
    child.end();
    root.end();
    await sdk.shutdown();

    const reader = new JsonlTraceReader(jsonlPath);

    const summaries = await reader.listSessions();
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.sessionId).toBe("session-1");
    expect(summaries[0]?.serviceName).toBe("svc");
    expect(summaries[0]?.traceCount).toBe(1);

    const tree = await reader.readSession("session-1");
    expect(tree?.sessionId).toBe("session-1");
    expect(tree?.traces).toHaveLength(1);
    expect(tree?.traces[0]?.root.name).toBe("root");
    expect(tree?.traces[0]?.root.children).toHaveLength(1);
    expect(tree?.traces[0]?.root.children[0]?.name).toBe("child");
  });

  it("returns undefined for a session that is not in the file", async () => {
    const sdk = createTraceSdk({ jsonlPath, sessionId: "session-1" });
    const root = startRootSpan(sdk.tracer, "root");
    root.end();
    await sdk.shutdown();

    const reader = new JsonlTraceReader(jsonlPath);
    expect(await reader.readSession("no-such-session")).toBeUndefined();
  });

  it("skips lines that fail to parse", async () => {
    const sdk = createTraceSdk({ jsonlPath, sessionId: "session-1" });
    const root = startRootSpan(sdk.tracer, "root");
    root.end();
    await sdk.shutdown();

    appendFileSync(jsonlPath, "not valid json\n");

    const reader = new JsonlTraceReader(jsonlPath);
    const tree = await reader.readSession("session-1");
    expect(tree?.traces).toHaveLength(1);
  });

  it("filters sessions and lists newest first", async () => {
    const older = JSON.stringify({
      sessionId: "session-old",
      serviceName: "svc",
      traceId: "t1",
      spanId: "s1",
      name: "root",
      startTime: "2026-01-01T00:00:00.000Z",
      endTime: "2026-01-01T00:00:01.000Z",
      attributes: {},
      events: [],
      status: { code: 0 },
    });
    const newer = JSON.stringify({
      sessionId: "session-new",
      serviceName: "svc",
      traceId: "t2",
      spanId: "s2",
      name: "root",
      startTime: "2026-01-02T00:00:00.000Z",
      endTime: "2026-01-02T00:00:01.000Z",
      attributes: {},
      events: [],
      status: { code: 0 },
    });
    writeFileSync(jsonlPath, `${older}\n${newer}\n`);

    const reader = new JsonlTraceReader(jsonlPath);
    const summaries = await reader.listSessions();

    expect(summaries.map((summary) => summary.sessionId)).toEqual(["session-new", "session-old"]);

    const oldSession = await reader.readSession("session-old");
    expect(oldSession?.traces).toHaveLength(1);
    expect(oldSession?.traces[0]?.root.spanId).toBe("s1");
  });
});
