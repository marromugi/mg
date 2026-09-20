import type { TraceReader } from "@mg/trace/store";
import type { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { renderPage } from "../app.js";
import { SessionsPage } from "../components/pages/SessionsPage/index.js";
import { SCHEME_COOKIE, parseScheme } from "../scheme.js";

export const registerSessionsRoute = (
  app: Hono,
  reader: TraceReader,
): void => {
  app.get("/", async (c) => {
    const sessions = await reader.listSessions();
    const scheme = parseScheme(getCookie(c, SCHEME_COOKIE));
    return c.html(
      renderPage(<SessionsPage sessions={sessions} scheme={scheme} />),
    );
  });
};
