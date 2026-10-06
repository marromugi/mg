import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { createSession } from "../session.js";
import { createMemorySecretStore } from "../test/memory-secret-store.js";
import { createMemoryStore } from "../test/memory-store.js";
import { createTestRuns } from "../test-run/index.js";

const ADDRESS = "127.0.0.1:4100";
const TOKEN = "launch-token";
const NAME = "OPENROUTER_API_KEY";

const open = async (secrets = createMemorySecretStore()) => {
  const app = createApp({
    session: createSession({ token: TOKEN, address: ADDRESS }),
    dataDir: "/unused",
    definitions: createMemoryStore(),
    secrets,
    runs: createTestRuns({ secrets, dataDir: "/unused" }),
  });
  const entered = await app.request(
    `http://${ADDRESS}/enter?token=${TOKEN}`,
    { headers: { Host: ADDRESS } },
  );
  const cookie = (entered.headers.get("Set-Cookie") ?? "").split(
    ";",
  )[0];

  return {
    get: (path: string) =>
      app.request(`http://${ADDRESS}${path}`, {
        headers: { Host: ADDRESS, Cookie: cookie ?? "" },
      }),
    post: (path: string, entries: [string, string][]) =>
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

describe("API keys page", () => {
  it("sets a key, shows only that it is set, and never draws the value", async () => {
    const secrets = createMemorySecretStore();
    const dashboard = await open(secrets);

    const before = await (await dashboard.get("/api-keys")).text();
    const saved = await dashboard.post(`/api-keys/${NAME}`, [
      [NAME, "verify-123"],
    ]);
    const after = await (await dashboard.get("/api-keys")).text();

    expect(before).toContain("OpenRouter API キー（未設定）");
    expect(saved.status).toBe(303);
    expect(saved.headers.get("Location")).toBe("/api-keys");
    expect(after).toContain("OpenRouter API キー（設定済み）");
    expect(after).not.toContain("verify-123");
    expect(after).toMatch(/<input[^>]*type="password"/);
    expect(after).not.toMatch(/<input[^>]*type="password"[^>]*value=/);
    expect(secrets.peek(NAME)).toBe("verify-123");
  });

  it("replaces a key that is already set", async () => {
    const secrets = createMemorySecretStore();
    const dashboard = await open(secrets);
    await dashboard.post(`/api-keys/${NAME}`, [[NAME, "first-key"]]);

    await dashboard.post(`/api-keys/${NAME}`, [[NAME, "second-key"]]);

    expect(secrets.peek(NAME)).toBe("second-key");
  });

  it("refuses an empty value with a message on the field and keeps the old key", async () => {
    const secrets = createMemorySecretStore();
    const dashboard = await open(secrets);
    await dashboard.post(`/api-keys/${NAME}`, [[NAME, "first-key"]]);

    const response = await dashboard.post(`/api-keys/${NAME}`, [
      [NAME, ""],
    ]);
    const html = await response.text();

    expect(response.status).toBe(422);
    expect(html).toContain(
      `<p id="${NAME}-error" class="text-meta text-error">キーを入力してください</p>`,
    );
    expect(secrets.peek(NAME)).toBe("first-key");
  });

  it("refuses a value that is too long with a message on the field and keeps the old key", async () => {
    const secrets = createMemorySecretStore({ maxBytes: 10 });
    const dashboard = await open(secrets);
    await dashboard.post(`/api-keys/${NAME}`, [[NAME, "first-key"]]);

    const response = await dashboard.post(`/api-keys/${NAME}`, [
      [NAME, "k".repeat(11)],
    ]);
    const html = await response.text();

    expect(response.status).toBe(422);
    expect(html).toContain(
      `<p id="${NAME}-error" class="text-meta text-error">キーが長すぎます。10 バイト以内にしてください</p>`,
    );
    expect(secrets.peek(NAME)).toBe("first-key");
  });

  it("shows the reason a save failed without the value", async () => {
    const dashboard = await open(
      createMemorySecretStore({
        setFailsWith: "Keychain write failed (exit 36): locked",
      }),
    );

    const response = await dashboard.post(`/api-keys/${NAME}`, [
      [NAME, "verify-123"],
    ]);
    const html = await response.text();

    expect(response.status).toBe(500);
    expect(html).toContain("Keychain write failed (exit 36): locked");
    expect(html).not.toContain("verify-123");
  });

  it("shows the reason the state cannot be read", async () => {
    const dashboard = await open(
      createMemorySecretStore({
        hasFailsWith: "Keychain lookup failed (exit 36): locked",
      }),
    );

    const response = await dashboard.get("/api-keys");
    const html = await response.text();

    expect(response.status).toBe(500);
    expect(html).toContain("Keychain lookup failed (exit 36): locked");
    expect(html).toContain('href="/harnesses"');
  });

  it("asks before deleting and then removes the key", async () => {
    const secrets = createMemorySecretStore();
    const dashboard = await open(secrets);
    await dashboard.post(`/api-keys/${NAME}`, [[NAME, "verify-123"]]);

    const confirmation = await dashboard.get(
      `/api-keys/${NAME}/delete`,
    );
    const stillSet = await (await dashboard.get("/api-keys")).text();
    const deleted = await dashboard.post(
      `/api-keys/${NAME}/delete`,
      [],
    );
    const afterwards = await (await dashboard.get("/api-keys")).text();

    expect(await confirmation.text()).toContain(
      "「OpenRouter API キー」を削除します。削除したものは元に戻せません。",
    );
    expect(stillSet).toContain("OpenRouter API キー（設定済み）");
    expect(deleted.status).toBe(303);
    expect(afterwards).toContain("OpenRouter API キー（未設定）");
    expect(secrets.peek(NAME)).toBeUndefined();
  });

  it("redraws the delete page with the reason when the delete fails", async () => {
    const dashboard = await open(
      createMemorySecretStore({
        deleteFailsWith: "Keychain delete failed (exit 36): locked",
      }),
    );

    const response = await dashboard.post(
      `/api-keys/${NAME}/delete`,
      [],
    );
    const html = await response.text();

    expect(response.status).toBe(500);
    expect(html).toContain("Keychain delete failed (exit 36): locked");
    expect(html).toContain("「OpenRouter API キー」を削除します。");
  });
});
