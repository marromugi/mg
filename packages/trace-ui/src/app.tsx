import type { TraceReader } from "@mg/trace/store";
import { Hono } from "hono";
import { renderToString } from "react-dom/server";
import { registerSessionRoute } from "./routes/session.js";
import { registerSessionsRoute } from "./routes/sessions.js";

export const renderPage = (
  element: Parameters<typeof renderToString>[0],
): string => `<!DOCTYPE html>${renderToString(element)}`;

export const createApp = (reader: TraceReader): Hono => {
  const app = new Hono();

  registerSessionsRoute(app, reader);
  registerSessionRoute(app, reader);

  return app;
};
