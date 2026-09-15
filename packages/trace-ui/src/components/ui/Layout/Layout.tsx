import { readFileSync } from "node:fs";
import type { ReactNode } from "react";

let css = "";
try {
  css = readFileSync(
    new URL("../../../../dist/styles.css", import.meta.url),
    "utf-8",
  );
} catch {
  console.warn("trace-ui: dist/styles.css not found; run `pnpm build`");
}

export const Layout = ({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) => (
  <html lang="ja" className="scheme-light-dark">
    <head>
      <meta charSet="utf-8" />
      <meta
        name="viewport"
        content="width=device-width, initial-scale=1"
      />
      <title>{title}</title>
      <style>{css}</style>
    </head>
    <body className="max-w-page px-8 py-6 font-sans">{children}</body>
  </html>
);
