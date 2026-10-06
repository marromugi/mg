import { readFile } from "node:fs/promises";
import type { Hono } from "hono";

// Resolves to dashboard/dist/styles.css from both src/ and dist/.
const STYLES_URL = new URL("../../dist/styles.css", import.meta.url);

export const registerStyles = (app: Hono): void => {
  app.get("/styles.css", async (c) => {
    let css: string;
    try {
      css = await readFile(STYLES_URL, "utf-8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(
          "dashboard/dist/styles.css not found; run `pnpm build`",
          { cause: error },
        );
      }
      throw error;
    }
    return c.body(css, 200, {
      "Content-Type": "text/css; charset=utf-8",
    });
  });
};
