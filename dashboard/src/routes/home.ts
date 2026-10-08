import type { Hono } from "hono";
import { renderPage } from "../render.js";

export const registerHome = (app: Hono): void => {
  app.get("/", (c) => c.html(renderPage("ホーム", "home", {})));
};
