import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { createSession } from "../session.js";
import { createMemoryStore } from "../test/memory-store.js";

const ADDRESS = "127.0.0.1:4100";
const TOKEN = "launch-token";

type Entries = [string, string][];

const FILES_HARNESS: Entries = [
  ["name", "files"],
  ["provider", "openrouter"],
  ["model", "deepseek/deepseek-v4-flash"],
  ["maxTurns", "10"],
  ["tools", "read_file"],
  ["tools", "grep"],
  ["root", "/tmp/work"],
  ["rules.0.paths", ".env"],
  ["rules.0.effect", "deny"],
  ["rules.0.reason", ""],
];

const without = (entries: Entries, ...keys: string[]): Entries =>
  entries.filter(([key]) => !keys.some((k) => key.startsWith(k)));

const open = async (store = createMemoryStore()) => {
  const app = createApp({
    session: createSession({ token: TOKEN, address: ADDRESS }),
    dataDir: "/unused",
    definitions: store,
  });
  const entered = await app.request(
    `http://${ADDRESS}/enter?token=${TOKEN}`,
    { headers: { Host: ADDRESS } },
  );
  const cookie = (entered.headers.get("Set-Cookie") ?? "").split(
    ";",
  )[0];

  const send = (path: string, init: RequestInit = {}) =>
    app.request(`http://${ADDRESS}${path}`, {
      ...init,
      headers: { Host: ADDRESS, Cookie: cookie ?? "" },
    });

  return {
    get: (path: string) => send(path),
    post: (path: string, entries: Entries) =>
      app.request(`http://${ADDRESS}${path}`, {
        method: "POST",
        headers: {
          Host: ADDRESS,
          Cookie: cookie ?? "",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams(entries).toString(),
      }),
  };
};

const submit = (
  action: "save" | "add-rule",
  entries: Entries,
): Entries => [...entries, ["intent", action]];

describe("harness editor", () => {
  it("saves a harness from the form and lists it with its values in the editor", async () => {
    const dashboard = await open();

    const saved = await dashboard.post(
      "/harnesses/new",
      submit("save", FILES_HARNESS),
    );
    const list = await (await dashboard.get("/harnesses")).text();
    const href =
      /href="(\/harnesses\/(?!new")[^"/]+)"/.exec(list)?.[1] ?? "";
    const editor = await (await dashboard.get(href)).text();

    expect(saved.status).toBe(303);
    expect(saved.headers.get("Location")).toBe("/harnesses");
    expect(list).toContain(">files</a>");
    expect(editor).toContain('name="name" value="files"');
    expect(editor).toContain('value="deepseek/deepseek-v4-flash"');
    expect(editor).toContain('name="maxTurns" value="10"');
    expect(editor).toContain('name="root" value="/tmp/work"');
    expect(editor).toMatch(/name="tools" checked="" value="read_file"/);
    expect(editor).toMatch(/name="tools" checked="" value="grep"/);
    expect(editor).not.toMatch(/name="tools" checked="" value="bash"/);
    expect(editor).toContain(">.env</textarea>");
  });

  it("does not save a harness with tools and neither a rule nor a judge", async () => {
    const dashboard = await open();

    const response = await dashboard.post(
      "/harnesses/new",
      submit("save", without(FILES_HARNESS, "rules.")),
    );
    const list = await (await dashboard.get("/harnesses")).text();

    expect(response.status).toBe(422);
    expect(await response.text()).toContain(
      "ツールを使うハーネスには、パスのルールか判定 LLM が要ります",
    );
    expect(list).toContain("ハーネスはまだありません");
  });

  it("names the field that is wrong and keeps the other values", async () => {
    const dashboard = await open();

    const response = await dashboard.post(
      "/harnesses/new",
      submit("save", [
        ...without(FILES_HARNESS, "maxTurns"),
        ["maxTurns", "0"],
      ]),
    );
    const html = await response.text();

    expect(response.status).toBe(422);
    expect(html).toContain("1 以上の整数で入力してください");
    expect(html).toContain('value="files"');
  });

  it("refuses a second harness with a taken name and says so on the name field", async () => {
    const dashboard = await open();
    await dashboard.post(
      "/harnesses/new",
      submit("save", FILES_HARNESS),
    );

    const response = await dashboard.post(
      "/harnesses/new",
      submit("save", FILES_HARNESS),
    );

    expect(response.status).toBe(422);
    expect(await response.text()).toContain(
      '<p id="name-error" class="text-meta text-error">この名前は、ほかのハーネスで使われています</p>',
    );
  });

  it("shows the reason a write failed and keeps the entered values", async () => {
    const dashboard = await open(
      createMemoryStore({ failWith: "disk is full" }),
    );

    const response = await dashboard.post(
      "/harnesses/new",
      submit("save", FILES_HARNESS),
    );
    const html = await response.text();

    expect(response.status).toBe(500);
    expect(html).toContain("disk is full");
    expect(html).toContain('value="files"');
    expect(html).toContain('value="/tmp/work"');
  });

  it("redraws the editor with one more rule row and saves nothing", async () => {
    const dashboard = await open();

    const response = await dashboard.post(
      "/harnesses/new",
      submit("add-rule", FILES_HARNESS),
    );
    const html = await response.text();
    const list = await (await dashboard.get("/harnesses")).text();

    expect(response.status).toBe(200);
    expect(html).toContain('name="rules.0.paths"');
    expect(html).toContain('name="rules.1.paths"');
    expect(html).not.toContain('name="rules.2.paths"');
    expect(html).toContain('value="files"');
    expect(list).toContain("ハーネスはまだありません");
  });

  it("asks before deleting and then removes the harness", async () => {
    const dashboard = await open();
    await dashboard.post(
      "/harnesses/new",
      submit("save", FILES_HARNESS),
    );
    const list = await (await dashboard.get("/harnesses")).text();
    const href =
      /href="(\/harnesses\/(?!new")[^"/]+)"/.exec(list)?.[1] ?? "";

    const confirmation = await dashboard.get(`${href}/delete`);
    const stillListed = await (
      await dashboard.get("/harnesses")
    ).text();
    const deleted = await dashboard.post(`${href}/delete`, []);
    const afterwards = await (await dashboard.get("/harnesses")).text();

    expect(await confirmation.text()).toContain(
      "「files」を削除します。削除したものは元に戻せません。",
    );
    expect(stillListed).toContain(">files</a>");
    expect(deleted.status).toBe(303);
    expect(afterwards).toContain("ハーネスはまだありません");
  });

  it("draws the Harnesses page with the reason when the list cannot be read", async () => {
    const dashboard = await open(
      createMemoryStore({ listFailsWith: "ENOTDIR: not a directory" }),
    );

    const response = await dashboard.get("/harnesses");
    const html = await response.text();

    expect(response.status).toBe(500);
    expect(html).toContain("ENOTDIR: not a directory");
    expect(html).toContain('href="/api-keys"');
  });

  it("redraws the delete page with the reason when the delete fails", async () => {
    const store = createMemoryStore({
      deleteFailsWith: "EACCES: permission denied",
    });
    const dashboard = await open(store);
    await dashboard.post(
      "/harnesses/new",
      submit("save", FILES_HARNESS),
    );
    const list = await (await dashboard.get("/harnesses")).text();
    const href =
      /href="(\/harnesses\/(?!new")[^"/]+)"/.exec(list)?.[1] ?? "";

    const response = await dashboard.post(`${href}/delete`, []);
    const html = await response.text();

    expect(response.status).toBe(500);
    expect(html).toContain("EACCES: permission denied");
    expect(html).toContain("「files」を削除します。");
  });
});
