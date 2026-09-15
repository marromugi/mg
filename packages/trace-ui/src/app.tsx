import type { TraceReader } from "@mg/trace/store";
import { Hono } from "hono";
import { renderToString } from "react-dom/server";
import { SessionPage } from "./pages/session.js";
import { SessionsPage } from "./pages/sessions.js";

const renderPage = (
  element: Parameters<typeof renderToString>[0],
): string => `<!DOCTYPE html>${renderToString(element)}`;

export const createApp = (reader: TraceReader): Hono => {
  const app = new Hono();

  app.get("/", async (c) => {
    const sessions = await reader.listSessions();
    return c.html(renderPage(<SessionsPage sessions={sessions} />));
  });

  app.get("/sessions/:id", async (c) => {
    const session = await reader.readSession(c.req.param("id"));
    if (session === undefined) {
      return c.notFound();
    }
    return c.html(renderPage(<SessionPage session={session} />));
  });

  return app;
};
