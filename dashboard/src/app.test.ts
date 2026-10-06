import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { createSession } from "./session.js";

const ADDRESS = "127.0.0.1:4100";
const TOKEN = "launch-token";

const build = () =>
  createApp({
    session: createSession({ token: TOKEN, address: ADDRESS }),
    dataDir: "/unused",
  });

const request = (
  app: ReturnType<typeof build>,
  path: string,
  init: { method?: string; headers?: Record<string, string> } = {},
) =>
  app.request(`http://${ADDRESS}${path}`, {
    method: init.method,
    headers: { Host: ADDRESS, ...init.headers },
  });

const enter = async (app: ReturnType<typeof build>) => {
  const response = await request(app, `/enter?token=${TOKEN}`);
  const cookie = response.headers.get("Set-Cookie") ?? "";
  return { response, cookie, pair: cookie.split(";")[0] ?? "" };
};

describe("launch link", () => {
  it("sets an HttpOnly SameSite=Strict cookie and moves to the home page", async () => {
    const { response, cookie } = await enter(build());

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/");
  });

  it("answers 401 and sets no cookie when used a second time", async () => {
    const app = build();
    await enter(app);

    const second = await enter(app);

    expect(second.response.status).toBe(401);
    expect(second.cookie).toBe("");
  });

  it("answers 401 for a wrong token", async () => {
    const response = await request(build(), "/enter?token=wrong");

    expect(response.status).toBe(401);
    expect(response.headers.get("Set-Cookie")).toBeNull();
  });
});

describe("pages", () => {
  it("shows the home page with links to Harnesses and API keys", async () => {
    const app = build();
    const { pair } = await enter(app);

    const response = await request(app, "/", {
      headers: { Cookie: pair },
    });
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('href="/harnesses"');
    expect(html).toContain('href="/api-keys"');
  });

  it("answers 401 without a session and says to open the launch link again", async () => {
    const response = await request(build(), "/");

    expect(response.status).toBe(401);
    expect(await response.text()).toContain(
      "起動時に表示されたリンクを、もう一度開いてください。",
    );
  });

  it("answers 403 when the Host is not the server's own address", async () => {
    const response = await request(build(), "/", {
      headers: { Host: "example.com" },
    });

    expect(response.status).toBe(403);
  });

  it("answers 403 to a form post whose Origin is another site", async () => {
    const app = build();
    const { pair } = await enter(app);

    const response = await request(app, "/harnesses", {
      method: "POST",
      headers: { Cookie: pair, Origin: "http://example.com" },
    });

    expect(response.status).toBe(403);
  });
});
