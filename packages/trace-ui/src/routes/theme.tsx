import { deleteCookie, setCookie } from "hono/cookie";
import type { Hono } from "hono";
import { SCHEME_COOKIE, parseScheme } from "../scheme.js";

export const registerThemeRoute = (app: Hono): void => {
  app.post("/theme", async (c) => {
    const body = await c.req.parseBody();
    const raw = body.scheme;
    const scheme = parseScheme(
      typeof raw === "string" ? raw : undefined,
    );

    if (scheme === "system") {
      deleteCookie(c, SCHEME_COOKIE, { path: "/" });
    } else {
      setCookie(c, SCHEME_COOKIE, scheme, {
        path: "/",
        sameSite: "Lax",
        maxAge: 31536000,
      });
    }

    const referer = c.req.header("Referer");
    const origin = new URL(c.req.url).origin;
    const location =
      referer !== undefined && referer.startsWith(origin)
        ? referer
        : "/";

    return c.redirect(location, 303);
  });
};
