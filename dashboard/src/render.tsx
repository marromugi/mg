import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";

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
