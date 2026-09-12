import { describe, expect, it } from "vitest";
import type { SpanRecord } from "./record.js";
import { buildSessionTree } from "./tree.js";

const record = (overrides: Partial<SpanRecord> & Pick<SpanRecord, "spanId">): SpanRecord => ({
  sessionId: "session-1",
  serviceName: "svc",
  traceId: "trace-1",
  parentSpanId: undefined,
  name: "span",
  startTime: "2026-01-01T00:00:00.000Z",
  endTime: "2026-01-01T00:00:01.000Z",
  attributes: {},
  events: [],
  status: { code: 0 },
  ...overrides,
});

describe("buildSessionTree", () => {
  it("returns undefined for an empty input", () => {
    expect(buildSessionTree([])).toBeUndefined();
  });

  it("nests children under their parent by parentSpanId", () => {
    const root = record({ spanId: "root", startTime: "2026-01-01T00:00:00.000Z" });
    const child = record({
      spanId: "child",
      parentSpanId: "root",
      startTime: "2026-01-01T00:00:01.000Z",
    });
    const grandchild = record({
      spanId: "grandchild",
      parentSpanId: "child",
      startTime: "2026-01-01T00:00:02.000Z",
    });

    const tree = buildSessionTree([root, child, grandchild]);

    expect(tree?.traces).toHaveLength(1);
    expect(tree?.traces[0]?.root.spanId).toBe("root");
    expect(tree?.traces[0]?.root.children).toHaveLength(1);
    expect(tree?.traces[0]?.root.children[0]?.spanId).toBe("child");
    expect(tree?.traces[0]?.root.children[0]?.children[0]?.spanId).toBe("grandchild");
  });

  it("drops parentSpanId from tree nodes", () => {
    const root = record({ spanId: "root" });
    const child = record({ spanId: "child", parentSpanId: "root" });

    const tree = buildSessionTree([root, child]);

    expect(tree?.traces[0]?.root.children[0]).not.toHaveProperty("parentSpanId");
  });

  it("sorts children of the same parent by startTime", () => {
    const root = record({ spanId: "root", startTime: "2026-01-01T00:00:00.000Z" });
    const late = record({
      spanId: "late",
      parentSpanId: "root",
      startTime: "2026-01-01T00:00:05.000Z",
    });
    const early = record({
      spanId: "early",
      parentSpanId: "root",
      startTime: "2026-01-01T00:00:01.000Z",
    });

    const tree = buildSessionTree([root, late, early]);

    expect(tree?.traces[0]?.root.children.map((child) => child.spanId)).toEqual([
      "early",
      "late",
    ]);
  });

  it("sorts traces by root startTime", () => {
    const rootB = record({
      spanId: "root-b",
      traceId: "trace-b",
      startTime: "2026-01-01T00:00:05.000Z",
    });
    const rootA = record({
      spanId: "root-a",
      traceId: "trace-a",
      startTime: "2026-01-01T00:00:01.000Z",
    });

    const tree = buildSessionTree([rootB, rootA]);

    expect(tree?.traces.map((trace) => trace.traceId)).toEqual(["trace-a", "trace-b"]);
  });

  it("keeps a span whose parent is missing as the root of its own trace", () => {
    const orphan = record({
      spanId: "orphan",
      traceId: "trace-1",
      parentSpanId: "missing-parent",
      startTime: "2026-01-01T00:00:00.000Z",
    });
    const normalRoot = record({
      spanId: "root",
      traceId: "trace-1",
      startTime: "2026-01-01T00:00:01.000Z",
    });

    const tree = buildSessionTree([orphan, normalRoot]);

    expect(tree?.traces).toHaveLength(2);
    const roots = tree?.traces.map((trace) => trace.root.spanId).sort();
    expect(roots).toEqual(["orphan", "root"]);
  });

  it("computes sessionId, serviceName, startTime and endTime for the session", () => {
    const a = record({
      spanId: "a",
      startTime: "2026-01-01T00:00:00.000Z",
      endTime: "2026-01-01T00:00:03.000Z",
    });
    const b = record({
      spanId: "b",
      traceId: "trace-2",
      startTime: "2026-01-01T00:00:01.000Z",
      endTime: "2026-01-01T00:00:05.000Z",
    });

    const tree = buildSessionTree([a, b]);

    expect(tree?.sessionId).toBe("session-1");
    expect(tree?.serviceName).toBe("svc");
    expect(tree?.startTime).toBe("2026-01-01T00:00:00.000Z");
    expect(tree?.endTime).toBe("2026-01-01T00:00:05.000Z");
  });
});
