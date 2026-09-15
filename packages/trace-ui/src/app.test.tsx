import type { SessionTree, TraceReader } from "@mg/trace/store";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import {
  END_TIME,
  OBJECT_CONTENT_SESSION_ID,
  SESSION_ID,
  sessionSummaries,
  sessionTree,
  objectContentSessionTree,
  START_TIME,
} from "./stories/fixtures.js";

const sessionsById = new Map<string, SessionTree>([
  [SESSION_ID, sessionTree],
  [OBJECT_CONTENT_SESSION_ID, objectContentSessionTree],
]);

class FakeTraceReader implements TraceReader {
  async listSessions() {
    return [sessionSummaries[0]];
  }

  async readSession(sessionId: string) {
    return sessionsById.get(sessionId);
  }
}

describe("createApp", () => {
  it("lists the session id, times, and trace count on GET /", async () => {
    const app = createApp(new FakeTraceReader());
    const res = await app.request("/");
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(text).toContain(SESSION_ID);
    expect(text).toContain(START_TIME);
    expect(text).toContain(END_TIME);
  });

  it("shows the model, a user message, a tool name, and a failed span's error on GET /sessions/:id", async () => {
    const app = createApp(new FakeTraceReader());
    const res = await app.request(`/sessions/${SESSION_ID}`);
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(text).toContain("gpt-test");
    expect(text).toContain("Hello there");
    expect(text).toContain("web-search");
    expect(text).toContain("search failed: timeout");
  });

  it("returns 200 for a span whose message content is not a string", async () => {
    const app = createApp(new FakeTraceReader());
    const res = await app.request(
      `/sessions/${OBJECT_CONTENT_SESSION_ID}`,
    );

    expect(res.status).toBe(200);
  });

  it("returns 404 for an unknown session id", async () => {
    const app = createApp(new FakeTraceReader());
    const res = await app.request("/sessions/no-such-session");

    expect(res.status).toBe(404);
  });
});
