import type { Hono } from "hono";
import { HarnessesPage } from "../components/pages/HarnessesPage/index.js";
import { renderPage } from "../render.js";

export const registerHarnesses = (app: Hono): void => {
  app.get("/harnesses", (c) =>
    c.html(renderPage("ハーネス", <HarnessesPage />)),
  );
};
