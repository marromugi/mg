import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Layout } from "./Layout.js";

describe("Layout", () => {
  it("renders the given CSS inside a style element", () => {
    const html = renderToString(
      <Layout
        title="Sessions"
        scheme="system"
        css="body{color:red}"
        schemeAction="/theme"
      >
        <p>content</p>
      </Layout>,
    );

    expect(html).toContain("<style>body{color:red}</style>");
  });

  it("renders an empty style element for an empty CSS string", () => {
    const html = renderToString(
      <Layout
        title="Sessions"
        scheme="system"
        css=""
        schemeAction="/theme"
      >
        <p>content</p>
      </Layout>,
    );

    expect(html).toContain("<style></style>");
  });

  it("posts each of the three scheme values to the given destination", () => {
    const html = renderToString(
      <Layout
        title="Sessions"
        scheme="system"
        css=""
        schemeAction="/theme"
      >
        <p>content</p>
      </Layout>,
    );
    const forms = html.split('action="/theme"').length - 1;

    expect(forms).toBe(3);
    for (const value of ["system", "light", "dark"]) {
      const fields =
        html.split(`name="scheme" value="${value}"`).length - 1;
      expect(fields).toBe(1);
    }
  });

  it("posts to the given destination instead of a hardcoded one", () => {
    const html = renderToString(
      <Layout
        title="Sessions"
        scheme="system"
        css=""
        schemeAction="/x/scheme"
      >
        <p>content</p>
      </Layout>,
    );

    expect(html.split('action="/x/scheme"').length - 1).toBe(3);
    expect(html.split('action="/theme"').length - 1).toBe(0);
  });
});
