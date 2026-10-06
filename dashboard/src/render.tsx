import type { ReactNode } from "react";
import { renderToStaticMarkup, renderToString } from "react-dom/server";

const Document = ({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) => (
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
    <body className="font-sans">{children}</body>
  </html>
);

export const renderPage = (title: string, page: ReactNode): string =>
  `<!DOCTYPE html>${renderToString(<Document title={title}>{page}</Document>)}`;

const SLOT = <template data-stream-slot="" />;

// Renders a page in two halves around `slot`, so that pieces made by
// `renderPiece` can be sent between them while the response is open.
export const renderPageAround = (
  title: string,
  build: (slot: ReactNode) => ReactNode,
): { head: string; tail: string } => {
  const html = renderPage(title, build(SLOT));
  const marker = renderToString(SLOT);
  const at = html.indexOf(marker);
  if (at === -1) throw new Error("the page does not place the slot");
  return {
    head: html.slice(0, at),
    tail: html.slice(at + marker.length),
  };
};

export const renderPiece = (piece: ReactNode): string =>
  renderToStaticMarkup(piece);
