import type { TraceReader } from "@mg/trace/store";
import type { Hono } from "hono";
import { renderPage } from "../app.js";
import { SessionsPage } from "../components/pages/SessionsPage/index.js";

export const registerSessionsRoute = (
  app: Hono,
  reader: TraceReader,
): void => {
  app.get("/", async (c) => {
    const sessions = await reader.listSessions();
    return c.html(renderPage(<SessionsPage sessions={sessions} />));
  });
};
