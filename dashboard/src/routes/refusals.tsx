import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { ForbiddenPage } from "../components/pages/ForbiddenPage/index.js";
import { NoSessionPage } from "../components/pages/NoSessionPage/index.js";
import { renderPage } from "../render.js";

export const registerRefusals = (app: Hono): void => {
  app.onError((error, c) => {
    if (error instanceof HTTPException && error.status === 401) {
      return c.html(
        renderPage("セッションがありません", <NoSessionPage />),
        401,
      );
    }
    if (error instanceof HTTPException && error.status === 403) {
      return c.html(
        renderPage("受け付けられません", <ForbiddenPage />),
        403,
      );
    }
    console.error(error);
    return c.text("Internal Server Error", 500);
  });
};
