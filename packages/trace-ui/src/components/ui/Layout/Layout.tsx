import { readFileSync } from "node:fs";
import type { ReactNode } from "react";
import { Button } from "@mg/ui";
import type { Scheme } from "../../../scheme.js";

let css = "";
try {
  css = readFileSync(
    new URL("../../../../dist/styles.css", import.meta.url),
    "utf-8",
  );
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
    throw error;
  }
  console.warn("trace-ui: dist/styles.css not found; run `pnpm build`");
}

const schemeClassName: Record<Scheme, string> = {
  system: "scheme-light-dark",
  light: "scheme-light",
  dark: "scheme-dark",
};

export const Layout = ({
  title,
  scheme,
  children,
}: {
  title: string;
  scheme: Scheme;
  children: ReactNode;
}) => (
  <html lang="ja" className={schemeClassName[scheme]}>
    <head>
      <meta charSet="utf-8" />
      <meta
        name="viewport"
        content="width=device-width, initial-scale=1"
      />
      <title>{title}</title>
      <style>{css}</style>
    </head>
    <body className="max-w-page px-8 py-6 font-sans">
      <nav className="flex gap-2" aria-label="配色">
        <form method="post" action="/theme">
          <input type="hidden" name="scheme" value="system" />
          <Button
            size="sm"
            tone={scheme === "system" ? "primary" : "neutral"}
          >
            OS
          </Button>
        </form>
        <form method="post" action="/theme">
          <input type="hidden" name="scheme" value="light" />
          <Button
            size="sm"
            tone={scheme === "light" ? "primary" : "neutral"}
          >
            明
          </Button>
        </form>
        <form method="post" action="/theme">
          <input type="hidden" name="scheme" value="dark" />
          <Button
            size="sm"
            tone={scheme === "dark" ? "primary" : "neutral"}
          >
            暗
          </Button>
        </form>
      </nav>
      {children}
    </body>
  </html>
);
