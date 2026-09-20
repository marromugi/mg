import type { TraceReader } from "@mg/trace/store";
import type { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { renderPage } from "../app.js";
import { SessionPage } from "../components/pages/SessionPage/index.js";
import { SCHEME_COOKIE, parseScheme } from "../scheme.js";

export const registerSessionRoute = (
  app: Hono,
  reader: TraceReader,
): void => {
  app.get("/sessions/:id", async (c) => {
    const session = await reader.readSession(c.req.param("id"));
    if (session === undefined) {
      return c.notFound();
    }
    const scheme = parseScheme(getCookie(c, SCHEME_COOKIE));
    return c.html(
      renderPage(<SessionPage session={session} scheme={scheme} />),
    );
  });
};
