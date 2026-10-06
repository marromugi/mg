import type { Context, Hono } from "hono";
import { ApiKeysPage } from "../components/pages/ApiKeysPage/index.js";
import { DeleteApiKeyPage } from "../components/pages/DeleteApiKeyPage/index.js";
import { renderPage } from "../render.js";
import {
  SECRET_NAMES,
  isSecretName,
  type SecretName,
  type SecretStore,
} from "../secret-store/index.js";

type Keys = { name: SecretName; isSet: boolean }[];

const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const page = (
  c: Context,
  keys: Keys,
  extra: {
    problem?: { name: SecretName; message: string };
    failure?: { kind: "read" | "write"; reason: string };
  } = {},
  status: 200 | 422 | 500 = 200,
) =>
  c.html(
    renderPage(
      "API キー",
      <ApiKeysPage
        keys={keys}
        problem={extra.problem}
        failure={extra.failure}
      />,
    ),
    status,
  );

export const registerApiKeys = (
  app: Hono,
  secrets: SecretStore,
): void => {
  const statuses = (): Promise<Keys> =>
    Promise.all(
      SECRET_NAMES.map(async (name) => ({
        name,
        isSet: await secrets.has(name),
      })),
    );

  // The page for a failed write still shows which keys are set, unless
  // that cannot be read either.
  const statusesOrNone = async (): Promise<Keys> => {
    try {
      return await statuses();
    } catch {
      return [];
    }
  };

  app.get("/api-keys", async (c) => {
    try {
      return page(c, await statuses());
    } catch (error) {
      return page(
        c,
        [],
        { failure: { kind: "read", reason: reasonOf(error) } },
        500,
      );
    }
  });

  app.post("/api-keys/:name", async (c) => {
    const name = c.req.param("name");
    if (!isSecretName(name)) return c.notFound();

    const body = await c.req.parseBody();
    const value = body[name];
    if (typeof value !== "string") return c.text("Bad Request", 400);

    if (value.trim() === "") {
      return page(
        c,
        await statusesOrNone(),
        { problem: { name, message: "キーを入力してください" } },
        422,
      );
    }

    try {
      await secrets.set(name, value);
    } catch (error) {
      return page(
        c,
        await statusesOrNone(),
        { failure: { kind: "write", reason: reasonOf(error) } },
        500,
      );
    }
    return c.redirect("/api-keys", 303);
  });

  app.get("/api-keys/:name/delete", async (c) => {
    const name = c.req.param("name");
    if (!isSecretName(name)) return c.notFound();
    let isSet: boolean;
    try {
      isSet = await secrets.has(name);
    } catch (error) {
      return c.html(
        renderPage(
          "API キーを削除",
          <DeleteApiKeyPage name={name} failure={reasonOf(error)} />,
        ),
        500,
      );
    }
    if (!isSet) return c.notFound();
    return c.html(
      renderPage("API キーを削除", <DeleteApiKeyPage name={name} />),
    );
  });

  app.post("/api-keys/:name/delete", async (c) => {
    const name = c.req.param("name");
    if (!isSecretName(name)) return c.notFound();
    try {
      await secrets.delete(name);
    } catch (error) {
      return c.html(
        renderPage(
          "API キーを削除",
          <DeleteApiKeyPage name={name} failure={reasonOf(error)} />,
        ),
        500,
      );
    }
    return c.redirect("/api-keys", 303);
  });
};
