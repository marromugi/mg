import type { Hono } from "hono";
import { ApiKeysPage } from "../components/pages/ApiKeysPage/index.js";
import { renderPage } from "../render.js";

export const registerApiKeys = (app: Hono): void => {
  app.get("/api-keys", (c) =>
    c.html(renderPage("API キー", <ApiKeysPage />)),
  );
};
