import type { TraceReader } from "@mg/trace/store";
import type { Hono } from "hono";
import { renderPage } from "../app.js";
import { SessionPage } from "../components/pages/SessionPage/index.js";

export const registerSessionRoute = (
  app: Hono,
  reader: TraceReader,
): void => {
  app.get("/sessions/:id", async (c) => {
    const session = await reader.readSession(c.req.param("id"));
    if (session === undefined) {
      return c.notFound();
    }
    return c.html(renderPage(<SessionPage session={session} />));
  });
};
