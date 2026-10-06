import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { createBrowserTools } from "./tools.js";
import type { BrowserPage } from "./browser.js";

const dir = mkdtempSync(join(tmpdir(), "mg-browser-tools-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

type Calls = {
  navigate: string[];
  click: { role: string; name: string }[];
  type: { role: string; name: string; text: string; submit: boolean }[];
};

const createFakePage = (
  overrides: Partial<BrowserPage> = {},
): BrowserPage & { calls: Calls } => {
  const calls: Calls = { navigate: [], click: [], type: [] };
  const page: BrowserPage & { calls: Calls } = {
    calls,
    async navigate(url) {
      calls.navigate.push(url);
      return { url: "https://example.com/", title: "Example" };
    },
    async snapshot() {
      return "- heading: Example";
    },
    async url() {
      return "https://example.com/";
    },
    async click(role, name) {
      calls.click.push({ role, name });
    },
    async type(role, name, text, submit) {
      calls.type.push({ role, name, text, submit });
    },
    ...overrides,
  };
  return page;
};

const getTool = (page: BrowserPage, name: string) => {
  const tool = createBrowserTools(page).find((t) => t.name === name);
  if (tool === undefined) {
    throw new Error(`tool not found: ${name}`);
  }
  return tool;
};

describe("createBrowserTools", () => {
  test("returns the four browser tools", () => {
    const page = createFakePage();
    const tools = createBrowserTools(page);

    expect(tools.map((tool) => tool.name)).toEqual([
      "browser_navigate",
      "browser_read",
      "browser_click",
      "browser_type",
    ]);
  });

  test("browser_navigate calls page.navigate and returns title and url", async () => {
    const page = createFakePage();
    const tool = getTool(page, "browser_navigate");

    const result = await (
      await tool.prepare({ url: "https://example.com" })
    ).run({});

    expect(page.calls.navigate).toEqual(["https://example.com"]);
    expect(result).toBe("Example\nhttps://example.com/");
  });

  test("browser_read returns the aria snapshot", async () => {
    const page = createFakePage();
    const tool = getTool(page, "browser_read");

    await expect((await tool.prepare({})).run({})).resolves.toBe(
      "- heading: Example",
    );
  });

  test("browser_read returns a small page whole and writes no file", async () => {
    const overflowDir = join(dir, "small");
    const page = createFakePage({
      snapshot: async () => "- heading: Example\n- link: More",
    });
    const tool = createBrowserTools(page, {
      maxOutputBytes: 100,
      overflowDir,
    }).find((t) => t.name === "browser_read")!;

    await expect((await tool.prepare({})).run({})).resolves.toBe(
      "- heading: Example\n- link: More",
    );
    expect(existsSync(overflowDir)).toBe(false);
  });

  test("browser_read returns the start of a large page and saves the whole to a file", async () => {
    const overflowDir = join(dir, "large");
    const snapshot = "- row 1\n- row 2\n- row 3\n- row 4\n";
    const page = createFakePage({ snapshot: async () => snapshot });
    const tool = createBrowserTools(page, {
      maxOutputBytes: 20,
      overflowDir,
    }).find((t) => t.name === "browser_read")!;

    const result = await (await tool.prepare({})).run({});

    const path = /Full output: (.+)\]$/.exec(result)?.[1] ?? "";
    expect(result).toBe(
      "- row 1\n- row 2\n" +
        "[showing lines 1-2 of 4 (15 B of 32 B). " +
        `Full output: ${path}]`,
    );
    expect(path.startsWith(overflowDir)).toBe(true);
    expect(readFileSync(path, "utf8")).toBe(snapshot);
  });

  test("browser_read cuts a long first line on a character boundary", async () => {
    const page = createFakePage({ snapshot: async () => "あいうえお" });
    const tool = createBrowserTools(page, {
      maxOutputBytes: 7,
      overflowDir: join(dir, "wide"),
    }).find((t) => t.name === "browser_read")!;

    const result = await (await tool.prepare({})).run({});

    expect(result).toMatch(
      /^あい\n\[showing the first 6 B of line 1 \(line is 15 B; 15 B in all\)\. Full output: .+\]$/,
    );
  });

  test("browser_read says when the saved copy stopped at the cap", async () => {
    const page = createFakePage({
      snapshot: async () => "0123456789abcdef",
    });
    const tool = createBrowserTools(page, {
      maxOutputBytes: 4,
      maxSavedBytes: 10,
      overflowDir: join(dir, "capped"),
    }).find((t) => t.name === "browser_read")!;

    const result = await (await tool.prepare({})).run({});

    expect(result).toMatch(
      /^0123\n\[showing the first 4 B of line 1 \(line is 10 B; 10 B in all\)\. Full output: .+\]\n\[stopped: output passed 10 B; the first 10 B is saved\]$/,
    );
  });

  test("browser_read fails with the path when the page cannot be saved", async () => {
    const blocked = join(dir, "blocked");
    writeFileSync(blocked, "");
    const page = createFakePage({ snapshot: async () => "abcdefghij" });
    const tool = createBrowserTools(page, {
      maxOutputBytes: 5,
      overflowDir: blocked,
    }).find((t) => t.name === "browser_read")!;

    await expect(
      (await tool.prepare({})).run({}),
    ).rejects.toMatchObject({
      name: "OutputSaveError",
      path: expect.stringContaining(blocked) as unknown,
    });
  });

  test("browser_read description names the limit and the saved file", () => {
    const tool = createBrowserTools(createFakePage(), {
      maxOutputBytes: 16384,
    }).find((t) => t.name === "browser_read")!;

    expect(tool.description).toContain(
      "Output over 16.0 KB is cut to its start; the full text is saved to a file whose path is given at the end of the result.",
    );
  });

  test("browser_click calls page.click with role and name", async () => {
    const page = createFakePage();
    const tool = getTool(page, "browser_click");

    const result = await (
      await tool.prepare({ role: "button", name: "Submit" })
    ).run({});

    expect(page.calls.click).toEqual([
      { role: "button", name: "Submit" },
    ]);
    expect(result).toBe("clicked");
  });

  test("browser_type calls page.type with role, name, text and submit", async () => {
    const page = createFakePage();
    const tool = getTool(page, "browser_type");

    const result = await (
      await tool.prepare({
        role: "textbox",
        name: "Search",
        text: "hello",
        submit: true,
      })
    ).run({});

    expect(page.calls.type).toEqual([
      { role: "textbox", name: "Search", text: "hello", submit: true },
    ]);
    expect(result).toBe("typed");
  });

  test("browser_type defaults submit to false", async () => {
    const page = createFakePage();
    const tool = getTool(page, "browser_type");

    await (
      await tool.prepare({
        role: "textbox",
        name: "Search",
        text: "hello",
      })
    ).run({});

    expect(page.calls.type).toEqual([
      { role: "textbox", name: "Search", text: "hello", submit: false },
    ]);
  });

  test("lets an exception thrown by the page through as-is", async () => {
    const cause = new Error(
      "strict mode violation: 2 elements resolved",
    );
    const page = createFakePage({
      click: async () => {
        throw cause;
      },
    });
    const tool = getTool(page, "browser_click");

    await expect(
      (await tool.prepare({ role: "button", name: "Submit" })).run({}),
    ).rejects.toBe(cause);
  });

  test("throws AbortError for an already-aborted signal", async () => {
    const page = createFakePage();
    const tool = getTool(page, "browser_navigate");
    const controller = new AbortController();
    controller.abort();

    await expect(
      (await tool.prepare({ url: "https://example.com" })).run({
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
