import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { readStyles } from "./styles.js";

describe("readStyles", () => {
  let dir: string;

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns a file's contents and does not warn", () => {
    dir = mkdtempSync(join(tmpdir(), "trace-ui-styles-"));
    const file = join(dir, "styles.css");
    writeFileSync(file, "a{b:c}");
    const warnings: string[] = [];

    const css = readStyles(pathToFileURL(file), (line) => {
      warnings.push(line);
    });

    expect(css).toBe("a{b:c}");
    expect(warnings).toHaveLength(0);
  });

  it("returns an empty string and warns once when the file is missing", () => {
    dir = mkdtempSync(join(tmpdir(), "trace-ui-styles-"));
    const file = join(dir, "missing.css");
    const warnings: string[] = [];

    const css = readStyles(pathToFileURL(file), (line) => {
      warnings.push(line);
    });

    expect(css).toBe("");
    expect(warnings).toEqual([
      "trace-ui: dist/styles.css not found; run `pnpm build`",
    ]);
  });

  it("throws an EISDIR error and does not warn when the location is a directory", () => {
    dir = mkdtempSync(join(tmpdir(), "trace-ui-styles-"));
    const warnings: string[] = [];

    expect(() =>
      readStyles(pathToFileURL(dir), (line) => {
        warnings.push(line);
      }),
    ).toThrowError(expect.objectContaining({ code: "EISDIR" }));
    expect(warnings).toHaveLength(0);
  });
});
