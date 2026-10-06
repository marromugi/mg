import type { Hono } from "hono";
import { HomePage } from "../components/pages/HomePage/index.js";
import { renderPage } from "../render.js";

export const registerHome = (app: Hono): void => {
  app.get("/", (c) => c.html(renderPage("ホーム", <HomePage />)));
};
