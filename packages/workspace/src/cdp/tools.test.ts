import { describe, expect, test } from "vitest";
import { createBrowserTools } from "./tools.js";
import type { BrowserPage } from "./browser.js";

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

    const result = await tool.execute(
      { url: "https://example.com" },
      {},
    );

    expect(page.calls.navigate).toEqual(["https://example.com"]);
    expect(result).toBe("Example\nhttps://example.com/");
  });

  test("browser_read returns the aria snapshot", async () => {
    const page = createFakePage();
    const tool = getTool(page, "browser_read");

    await expect(tool.execute({}, {})).resolves.toBe(
      "- heading: Example",
    );
  });

  test("browser_read truncates output over the limit and marks it", async () => {
    const page = createFakePage({
      snapshot: async () => "abcdefghij",
    });
    const tool = createBrowserTools(page, { maxOutputBytes: 5 }).find(
      (t) => t.name === "browser_read",
    )!;

    await expect(tool.execute({}, {})).resolves.toBe(
      "abcde\n[output truncated]",
    );
  });

  test("browser_read truncates on a code-point boundary, not mid-character", async () => {
    const page = createFakePage({
      snapshot: async () => "あいう",
    });
    const tool = createBrowserTools(page, { maxOutputBytes: 4 }).find(
      (t) => t.name === "browser_read",
    )!;

    const result = await tool.execute({}, {});

    expect(result).toBe("あ\n[output truncated]");
    expect(result).not.toContain("�");
  });

  test("browser_click calls page.click with role and name", async () => {
    const page = createFakePage();
    const tool = getTool(page, "browser_click");

    const result = await tool.execute(
      { role: "button", name: "Submit" },
      {},
    );

    expect(page.calls.click).toEqual([
      { role: "button", name: "Submit" },
    ]);
    expect(result).toBe("clicked");
  });

  test("browser_type calls page.type with role, name, text and submit", async () => {
    const page = createFakePage();
    const tool = getTool(page, "browser_type");

    const result = await tool.execute(
      { role: "textbox", name: "Search", text: "hello", submit: true },
      {},
    );

    expect(page.calls.type).toEqual([
      { role: "textbox", name: "Search", text: "hello", submit: true },
    ]);
    expect(result).toBe("typed");
  });

  test("browser_type defaults submit to false", async () => {
    const page = createFakePage();
    const tool = getTool(page, "browser_type");

    await tool.execute(
      { role: "textbox", name: "Search", text: "hello" },
      {},
    );

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
      tool.execute({ role: "button", name: "Submit" }, {}),
    ).rejects.toBe(cause);
  });

  test("throws AbortError for an already-aborted signal", async () => {
    const page = createFakePage();
    const tool = getTool(page, "browser_navigate");
    const controller = new AbortController();
    controller.abort();

    await expect(
      tool.execute(
        { url: "https://example.com" },
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
