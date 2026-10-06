import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCredentialAccess } from "@mg/credentials";
import { afterAll, describe, expect, test } from "vitest";
import { createCdpConnector } from "./index.js";
import type { BrowserPage } from "./browser.js";

const dir = mkdtempSync(join(tmpdir(), "mg-cdp-credentials-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const access = createCredentialAccess({
  store: {
    read: async (name, field) =>
      `${name}.${field}` === "demo.username"
        ? "alice@example.com"
        : "hunter2abc",
  },
  entries: [
    {
      name: "demo",
      origins: ["http://127.0.0.1:8787"],
      fields: ["username", "password"],
    },
  ],
  approval: { needed: false },
});

type Script = Partial<BrowserPage> & { snapshotText?: string };

const setup = async (
  script: Script = {},
  limits: { maxOutputBytes?: number; overflowDir?: string } = {},
) => {
  const typed: { role: string; name: string; text: string }[] = [];
  const page: BrowserPage = {
    navigate: async (url) => ({ url, title: "" }),
    snapshot: async () => script.snapshotText ?? "",
    url: async () => "http://127.0.0.1:8787/login",
    click: async () => {},
    type: async (role, name, text) => {
      typed.push({ role, name, text });
    },
    ...script,
  };
  const connection = await createCdpConnector(
    {
      url: "http://localhost:9222",
      browser: "build-browser",
      credentials: access,
      ...limits,
    },
    { connect: async () => ({ page, close: async () => {} }) },
  ).open();
  const run = async (name: string, input: object) => {
    const tool = connection.tools.find((t) => t.name === name)!;
    return (await tool.prepare(input)).run({});
  };
  return { connection, run, typed };
};

const fillPassword = {
  role: "textbox",
  name: "Password",
  credential: "demo",
  field: "password",
};

describe("createCdpConnector with a credential access", () => {
  test("open() adds browser_credentials and browser_fill_credential", async () => {
    const { connection } = await setup();

    expect(connection.tools.map((tool) => tool.name)).toEqual([
      "browser_navigate",
      "browser_read",
      "browser_click",
      "browser_type",
      "browser_credentials",
      "browser_fill_credential",
    ]);
  });

  test("browser_credentials lists the logins registered for the page's origin", async () => {
    const { run } = await setup();

    await expect(run("browser_credentials", {})).resolves.toBe(
      "demo: username, password",
    );
  });

  test("browser_credentials lists nothing on another origin", async () => {
    const { run } = await setup({
      url: async () => "http://localhost:8787/login",
    });

    await expect(run("browser_credentials", {})).resolves.toBe(
      "no saved logins can be used at http://localhost:8787",
    );
  });

  test("browser_fill_credential types the stored value and says what it filled", async () => {
    const { run, typed } = await setup();

    await expect(
      run("browser_fill_credential", fillPassword),
    ).resolves.toBe("filled demo.password");
    expect(typed).toEqual([
      { role: "textbox", name: "Password", text: "hunter2abc" },
    ]);
  });

  test("browser_fill_credential refuses on another origin and types nothing", async () => {
    const { run, typed } = await setup({
      url: async () => "http://localhost:8787/login",
    });

    await expect(
      run("browser_fill_credential", fillPassword),
    ).rejects.toThrow(
      "demo is not registered for http://localhost:8787",
    );
    expect(typed).toEqual([]);
  });

  test("browser_fill_credential refuses on a page with no origin and types nothing", async () => {
    const { run, typed } = await setup({
      url: async () => "about:blank",
    });

    await expect(
      run("browser_fill_credential", fillPassword),
    ).rejects.toThrow(
      "the current page has no origin (it is not an http or https page), so no saved login can be used on it",
    );
    expect(typed).toEqual([]);
  });

  test("page text shows a marker where a filled value appears", async () => {
    const { run } = await setup({
      snapshotText: "- text: hunter2abc\n- text: alice@example.com",
    });
    await run("browser_fill_credential", fillPassword);
    await run("browser_fill_credential", {
      ...fillPassword,
      name: "User",
      field: "username",
    });

    await expect(run("browser_read", {})).resolves.toBe(
      "- text: [credential demo.password]\n" +
        "- text: [credential demo.username]",
    );
  });

  test("the file a large page read saves shows the marker too", async () => {
    const overflowDir = join(dir, "saved");
    const rows = "- text: x\n".repeat(20);
    const { run } = await setup(
      { snapshotText: `${rows}- text: hunter2abc\n` },
      { maxOutputBytes: 40, overflowDir },
    );
    await run("browser_fill_credential", fillPassword);

    const result = await run("browser_read", {});

    const path = /Full output: (.+)\]$/.exec(result)?.[1] ?? "";
    expect(readFileSync(path, "utf8")).toBe(
      `${rows}- text: [credential demo.password]\n`,
    );
    expect(result).not.toContain("hunter2abc");
  });

  test("a page title and address show the marker", async () => {
    const { run } = await setup({
      navigate: async (url) => ({ url, title: "hello hunter2abc" }),
    });
    await run("browser_fill_credential", fillPassword);

    await expect(
      run("browser_navigate", {
        url: "http://127.0.0.1:8787/?password=hunter2abc",
      }),
    ).resolves.toBe(
      "hello [credential demo.password]\n" +
        "http://127.0.0.1:8787/?password=[credential demo.password]",
    );
  });

  test("a page failure shows the marker", async () => {
    const { run } = await setup({
      click: async () => {
        throw new Error("no button named hunter2abc");
      },
    });
    await run("browser_fill_credential", fillPassword);

    await expect(
      run("browser_click", { role: "button", name: "Go" }),
    ).rejects.toThrow("no button named [credential demo.password]");
  });
});
