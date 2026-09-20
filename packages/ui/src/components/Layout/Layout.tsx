import type { ReactNode } from "react";
import type { Scheme } from "../../scheme.js";
import { SCHEME_FIELD } from "../../scheme.js";
import { Button } from "../Button/index.js";

const schemeClassName: Record<Scheme, string> = {
  system: "scheme-light-dark",
  light: "scheme-light",
  dark: "scheme-dark",
};

export const Layout = ({
  title,
  scheme,
  css,
  schemeAction,
  children,
}: {
  title: string;
  scheme: Scheme;
  css: string;
  schemeAction: string;
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
        <form method="post" action={schemeAction}>
          <input type="hidden" name={SCHEME_FIELD} value="system" />
          <Button
            size="sm"
            tone={scheme === "system" ? "primary" : "neutral"}
          >
            OS
          </Button>
        </form>
        <form method="post" action={schemeAction}>
          <input type="hidden" name={SCHEME_FIELD} value="light" />
          <Button
            size="sm"
            tone={scheme === "light" ? "primary" : "neutral"}
          >
            明
          </Button>
        </form>
        <form method="post" action={schemeAction}>
          <input type="hidden" name={SCHEME_FIELD} value="dark" />
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
