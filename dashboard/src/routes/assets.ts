import { readFile } from "node:fs/promises";
import type { Hono } from "hono";

// The built files a page loads, by the path it asks for. They resolve
// to dashboard/dist/ from both src/ and dist/.
const ASSETS = [
  {
    path: "/styles.css",
    file: "styles.css",
    type: "text/css; charset=utf-8",
  },
  {
    path: "/browser.js",
    file: "browser.js",
    type: "text/javascript; charset=utf-8",
  },
] as const;

export const registerAssets = (app: Hono): void => {
  for (const asset of ASSETS) {
    app.get(asset.path, async (c) => {
      let text: string;
      try {
        text = await readFile(
          new URL(`../../dist/${asset.file}`, import.meta.url),
          "utf-8",
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          throw new Error(
            `dashboard/dist/${asset.file} not found; run \`pnpm build\``,
            { cause: error },
          );
        }
        throw error;
      }
      return c.body(text, 200, { "Content-Type": asset.type });
    });
  }
};
