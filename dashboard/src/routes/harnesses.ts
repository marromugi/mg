import type { Hono } from "hono";
import type { DefinitionStore } from "../definition-store/index.js";
import { renderPage } from "../render.js";

const TITLE = "エージェント";

const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const registerHarnesses = (
  app: Hono,
  store: DefinitionStore,
): void => {
  app.get("/harnesses", async (c) => {
    try {
      const { definitions, unreadable } = await store.list();
      return c.html(
        renderPage(TITLE, "harnesses", { definitions, unreadable }),
      );
    } catch (error) {
      return c.html(
        renderPage(TITLE, "harnesses", {
          definitions: [],
          unreadable: [],
          failure: reasonOf(error),
        }),
        500,
      );
    }
  });

  app.get("/harnesses/:id", async (c) => {
    const definition = await store.get(c.req.param("id"));
    if (definition === undefined) return c.notFound();
    return c.html(
      renderPage(definition.name, "harness", { definition }),
    );
  });
};
