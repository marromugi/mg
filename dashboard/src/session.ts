import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";

const ENTER_PATH = "/enter";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export type Session = {
  middleware: MiddlewareHandler;
};

const digest = (value: string): Buffer =>
  createHash("sha256").update(value).digest();

// Refusals are thrown as HTTPException so this file draws no markup;
// the app turns them into pages.
export const createSession = (options: {
  token: string;
  address: string;
}): Session => {
  const origin = `http://${options.address}`;
  // Cookies are scoped by host, not port; the port keeps two servers apart.
  const cookieName = `mg_dashboard_session_${options.address.split(":").pop()}`;
  const tokenDigest = digest(options.token);
  const sessions = new Set<string>();
  let tokenUsed = false;

  const middleware: MiddlewareHandler = async (c, next) => {
    if (c.req.header("Host") !== options.address) {
      throw new HTTPException(403);
    }

    const sentOrigin = c.req.header("Origin");
    if (
      !SAFE_METHODS.has(c.req.method) &&
      sentOrigin !== undefined &&
      sentOrigin !== origin
    ) {
      throw new HTTPException(403);
    }

    if (c.req.method === "GET" && c.req.path === ENTER_PATH) {
      const sent = c.req.query("token");
      if (
        tokenUsed ||
        sent === undefined ||
        !timingSafeEqual(digest(sent), tokenDigest)
      ) {
        throw new HTTPException(401);
      }
      tokenUsed = true;
      const id = randomBytes(32).toString("hex");
      sessions.add(id);
      setCookie(c, cookieName, id, {
        httpOnly: true,
        sameSite: "Strict",
        path: "/",
      });
      c.header("Cache-Control", "no-store");
      return c.redirect("/", 303);
    }

    const id = getCookie(c, cookieName);
    if (id === undefined || !sessions.has(id)) {
      throw new HTTPException(401);
    }
    await next();
  };

  return { middleware };
};
