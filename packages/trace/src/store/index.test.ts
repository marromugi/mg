import { describe, expect, it, vi } from "vitest";

vi.mock("@opentelemetry/sdk-trace-base", () => {
  throw new Error("must not be loaded");
});

describe("@mg/trace/store entry point", () => {
  it("does not load @opentelemetry/sdk-trace-base", async () => {
    const store = await import("./index.js");
    expect(store.JsonlTraceReader).toBeDefined();
    expect(store.buildSessionTree).toBeDefined();
  });
});
