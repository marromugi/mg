import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import {
  PAGES,
  type PageName,
  type PageProps,
} from "./components/pages/pages.js";

import { PAGE_DATA_ID, ROOT_ID, type PageData } from "./page-data.js";

const ROOT = `<div id="${ROOT_ID}"></div>`;

// JSON that cannot end the script element it sits in.
const scriptSafe = (data: PageData): string =>
  JSON.stringify(data).replaceAll("<", "\\u003c");

// The whole document for one page: the page drawn on the server, what
// it was drawn from, and the script that takes it over in the browser.
export const renderPage = <Name extends PageName>(
  title: string,
  name: Name,
  props: PageProps<Name>,
): string => {
  const shell = renderToStaticMarkup(
    <html lang="ja">
      <head>
        <meta charSet="utf-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1"
        />
        <title>{title}</title>
        <link rel="stylesheet" href="/styles.css" />
      </head>
      <body className="font-sans">
        <div id={ROOT_ID} />
        <script
          id={PAGE_DATA_ID}
          type="application/json"
          dangerouslySetInnerHTML={{
            __html: scriptSafe({ name, props }),
          }}
        />
        <script type="module" src="/browser.js" />
      </body>
    </html>,
  );
  const page = renderToString(
    createElement(PAGES[name] as ComponentType<object>, props),
  );
  return `<!DOCTYPE html>${shell.replace(ROOT, () => `<div id="${ROOT_ID}">${page}</div>`)}`;
};
