import type { ReactNode } from "react";

const STYLE = `
  :root { color-scheme: light dark; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    margin: 0;
    padding: 24px 32px;
    max-width: 960px;
  }
  h1 { font-size: 1.4rem; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid #8884; }
  a { color: inherit; }
  .span {
    border: 1px solid #8884;
    border-radius: 8px;
    padding: 10px 14px;
    margin: 10px 0;
  }
  .span-error { border-color: #d33; background: #fde8e6; color: #3b0d0a; }
  .span-header { display: flex; justify-content: space-between; gap: 12px; font-weight: 600; }
  .span-time { font-weight: 400; opacity: 0.7; font-size: 0.85rem; }
  .error { color: #d33; font-weight: 600; }
  .label { font-weight: 600; margin-top: 8px; }
  .message { border-left: 3px solid #8884; padding: 4px 10px; margin: 6px 0; }
  .role { font-weight: 600; text-transform: uppercase; font-size: 0.75rem; opacity: 0.7; }
  .content { white-space: pre-wrap; }
  code { white-space: pre-wrap; word-break: break-all; }
  .children { margin-left: 20px; }
`;

export const Layout = ({
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
      <style>{STYLE}</style>
    </head>
    <body>{children}</body>
  </html>
);
