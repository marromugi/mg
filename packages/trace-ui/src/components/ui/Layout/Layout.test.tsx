import { existsSync, readFileSync } from "node:fs";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Layout } from "./Layout.js";

const distStylesPath = new URL(
  "../../../../dist/styles.css",
  import.meta.url,
);

describe("Layout", () => {
  it.runIf(existsSync(distStylesPath))(
    "renders a <style> with the generated CSS",
    () => {
      const css = readFileSync(distStylesPath, "utf-8");
      const html = renderToString(
        <Layout title="Sessions">
          <p>content</p>
        </Layout>,
      );

      expect(html).toContain(`<style>${css}</style>`);
    },
  );
});
