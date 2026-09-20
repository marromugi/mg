import { parseScheme, SCHEME_FIELD } from "@mg/ui";
import { deleteCookie, setCookie } from "hono/cookie";
import type { Hono } from "hono";
import { SCHEME_COOKIE } from "../scheme.js";

export const registerThemeRoute = (app: Hono): void => {
  app.post("/theme", async (c) => {
    const body = await c.req.parseBody();
    const raw = body[SCHEME_FIELD];
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
    const refererOrigin = (() => {
      if (referer === undefined) {
        return undefined;
      }
      try {
        return new URL(referer).origin;
      } catch {
        return undefined;
      }
    })();
    const location =
      refererOrigin === origin && referer !== undefined ? referer : "/";

    return c.redirect(location, 303);
  });
};
