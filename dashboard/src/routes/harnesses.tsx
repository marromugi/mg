import { randomUUID } from "node:crypto";
import type { Context, Hono } from "hono";
import {
  HarnessEditorPage,
  type EditorTarget,
} from "../components/pages/HarnessEditorPage/index.js";
import { DeleteHarnessPage } from "../components/pages/DeleteHarnessPage/index.js";
import { RunNotStartedPage } from "../components/pages/RunNotStartedPage/index.js";
import { HarnessesPage } from "../components/pages/HarnessesPage/index.js";
import type { Problem } from "../definition/index.js";
import type { DefinitionStore } from "../definition-store/index.js";
import {
  draftFromDefinition,
  emptyDraft,
  readSubmission,
  saveDraft,
  withRuleAdded,
  withRuleRemoved,
  type Draft,
} from "../harness-form/index.js";
import { renderPage } from "../render.js";
import type { TestRuns } from "../test-run/index.js";

type Redraw = {
  draft: Draft;
  problems?: Problem[];
  failure?: string;
  runProblem?: string;
};

const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const editor = (
  c: Context,
  target: EditorTarget,
  redraw: Redraw,
  status: 200 | 422 | 500 = 200,
) =>
  c.html(
    renderPage(
      "ハーネス",
      <HarnessEditorPage
        target={target}
        draft={redraw.draft}
        problems={redraw.problems ?? []}
        failure={redraw.failure}
        runProblem={redraw.runProblem}
      />,
    ),
    status,
  );

export const registerHarnesses = (
  app: Hono,
  store: DefinitionStore,
  runs: TestRuns,
): void => {
  // A form post from the editor: redraws it for the buttons that edit
  // the form, and saves it for the Save button.
  const submit = async (
    c: Context,
    target: EditorTarget,
    id: string,
  ) => {
    const submission = readSubmission(
      await c.req.parseBody({ all: true }),
    );
    if (submission === undefined) return c.text("Bad Request", 400);

    const { draft, intent } = submission;
    if (intent.kind === "add-rule") {
      return editor(c, target, { draft: withRuleAdded(draft) });
    }
    if (intent.kind === "remove-rule") {
      return editor(c, target, {
        draft: withRuleRemoved(draft, intent.index),
      });
    }

    const result = await saveDraft(store, id, draft);
    switch (result.kind) {
      case "saved":
        return c.redirect("/harnesses", 303);
      case "refused":
        return editor(
          c,
          target,
          { draft, problems: result.problems },
          422,
        );
      case "failed":
        return editor(
          c,
          target,
          { draft, failure: result.reason },
          500,
        );
    }
  };

  app.get("/harnesses", async (c) => {
    try {
      const { definitions, unreadable } = await store.list();
      return c.html(
        renderPage(
          "ハーネス",
          <HarnessesPage
            definitions={definitions}
            unreadable={unreadable}
          />,
        ),
      );
    } catch (error) {
      return c.html(
        renderPage(
          "ハーネス",
          <HarnessesPage
            definitions={[]}
            unreadable={[]}
            failure={reasonOf(error)}
          />,
        ),
        500,
      );
    }
  });

  app.get("/harnesses/new", (c) =>
    editor(c, { kind: "new" }, { draft: emptyDraft() }),
  );

  app.post("/harnesses/new", (c) =>
    submit(c, { kind: "new" }, randomUUID()),
  );

  app.get("/harnesses/:id", async (c) => {
    const id = c.req.param("id");
    const definition = await store.get(id);
    if (definition === undefined) return c.notFound();
    return editor(
      c,
      { kind: "edit", id },
      { draft: draftFromDefinition(definition) },
    );
  });

  app.post("/harnesses/:id", async (c) => {
    const id = c.req.param("id");
    if ((await store.get(id)) === undefined) return c.notFound();
    return submit(c, { kind: "edit", id }, id);
  });

  app.post("/harnesses/:id/runs", async (c) => {
    const id = c.req.param("id");
    const definition = await store.get(id);
    if (definition === undefined) return c.notFound();

    const input = (await c.req.parseBody())["input"];
    if (typeof input !== "string") return c.text("Bad Request", 400);
    if (input.trim() === "") {
      return editor(
        c,
        { kind: "edit", id },
        {
          draft: draftFromDefinition(definition),
          runProblem: "入力を書いてください",
        },
        422,
      );
    }

    const started = await runs.start(definition, input);
    if (!started.ok) {
      return c.html(
        renderPage(
          "テスト実行",
          <RunNotStartedPage
            missingSecret={started.missingSecret}
            harnessHref={`/harnesses/${id}`}
          />,
        ),
        422,
      );
    }
    return c.redirect(`/runs/${started.runId}`, 303);
  });

  app.get("/harnesses/:id/delete", async (c) => {
    const definition = await store.get(c.req.param("id"));
    if (definition === undefined) return c.notFound();
    return c.html(
      renderPage(
        "ハーネスを削除",
        <DeleteHarnessPage definition={definition} />,
      ),
    );
  });

  app.post("/harnesses/:id/delete", async (c) => {
    const id = c.req.param("id");
    if ((await store.get(id)) === undefined) return c.notFound();
    try {
      await store.delete(id);
    } catch (error) {
      const definition = await store.get(id);
      if (definition === undefined) return c.notFound();
      return c.html(
        renderPage(
          "ハーネスを削除",
          <DeleteHarnessPage
            definition={definition}
            failure={reasonOf(error)}
          />,
        ),
        500,
      );
    }
    return c.redirect("/harnesses", 303);
  });
};
