import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TextField } from "./TextField.js";

describe("TextField", () => {
  it("links the label to the input", () => {
    const html = renderToStaticMarkup(
      <TextField name="query" label="Search" />,
    );

    expect(html).toContain('for="field-query"');
    expect(html).toContain('id="field-query"');
  });

  it("has no aria-describedby without hint or error", () => {
    const html = renderToStaticMarkup(
      <TextField name="query" label="Search" />,
    );

    expect(html).not.toContain("aria-describedby");
    expect(html).not.toContain("aria-invalid");
  });

  it("wires aria-describedby to the hint", () => {
    const html = renderToStaticMarkup(
      <TextField
        name="query"
        label="Search"
        hint="Matches span name."
      />,
    );

    expect(html).toContain('aria-describedby="field-query-hint"');
  });

  it("wires aria-describedby and aria-invalid to the error", () => {
    const html = renderToStaticMarkup(
      <TextField name="query" label="Search" error="Required." />,
    );

    expect(html).toContain('aria-describedby="field-query-error"');
    expect(html).toContain('aria-invalid="true"');
  });

  it("joins hint and error ids in aria-describedby", () => {
    const html = renderToStaticMarkup(
      <TextField
        name="query"
        label="Search"
        hint="Matches span name."
        error="Required."
      />,
    );

    expect(html).toContain(
      'aria-describedby="field-query-hint field-query-error"',
    );
  });

  it("wires the label, hint, and error to a given id", () => {
    const html = renderToStaticMarkup(
      <TextField
        id="q2"
        name="query"
        label="Search"
        hint="Matches span name."
        error="Required."
      />,
    );

    expect(html).toContain('for="q2"');
    expect(html).toContain('id="q2"');
    expect(html).toContain('aria-describedby="q2-hint q2-error"');
  });
});
