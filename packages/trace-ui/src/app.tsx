import type { TraceReader } from "@mg/trace/store";
import { Hono } from "hono";
import { renderToString } from "react-dom/server";
import { registerSessionRoute } from "./routes/session.js";
import { registerSessionsRoute } from "./routes/sessions.js";
import { registerThemeRoute } from "./routes/theme.js";
import { styles } from "./styles.js";

export const renderPage = (
  element: Parameters<typeof renderToString>[0],
): string => `<!DOCTYPE html>${renderToString(element)}`;

export const buildApp = (reader: TraceReader, css: string): Hono => {
  const app = new Hono();

  registerSessionsRoute(app, reader, css);
  registerSessionRoute(app, reader, css);
  registerThemeRoute(app);

  return app;
};

export const createApp = (reader: TraceReader): Hono =>
  buildApp(reader, styles);
