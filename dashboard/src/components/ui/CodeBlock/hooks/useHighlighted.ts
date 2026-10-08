import { useEffect, useState } from "react";
import {
  createHighlighterCore,
  type HighlighterCore,
} from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

// The languages that are coloured. Any other is shown as plain text.
const LANGUAGES = [
  "json",
  "typescript",
  "tsx",
  "javascript",
  "shellscript",
  "markdown",
] as const;

const isColoured = (language: string): boolean =>
  LANGUAGES.some((known) => known === language);

let highlighter: Promise<HighlighterCore> | undefined;

// One highlighter for the page, made the first time code is shown.
const loaded = (): Promise<HighlighterCore> => {
  highlighter ??= createHighlighterCore({
    engine: createJavaScriptRegexEngine(),
    themes: [
      import("shiki/themes/github-light.mjs"),
      import("shiki/themes/github-dark.mjs"),
    ],
    langs: [
      import("shiki/langs/json.mjs"),
      import("shiki/langs/typescript.mjs"),
      import("shiki/langs/tsx.mjs"),
      import("shiki/langs/javascript.mjs"),
      import("shiki/langs/shellscript.mjs"),
      import("shiki/langs/markdown.mjs"),
    ],
  });
  return highlighter;
};

// The code as coloured HTML, once it is ready in the browser. Until
// then, and on the server, it is undefined and the code shows plain.
// The colours follow the page's colour scheme.
export const useHighlighted = (
  code: string,
  language: string,
): string | undefined => {
  const [html, setHtml] = useState<string>();

  useEffect(() => {
    let current = true;
    void loaded().then((shiki) => {
      if (!current) return;
      setHtml(
        shiki.codeToHtml(code, {
          lang: isColoured(language) ? language : "text",
          themes: { light: "github-light", dark: "github-dark" },
          defaultColor: "light-dark()",
        }),
      );
    });
    return () => {
      current = false;
    };
  }, [code, language]);

  return html;
};
