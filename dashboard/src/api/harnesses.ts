import { randomUUID } from "node:crypto";
import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import type { DefinitionStore } from "../definition-store/index.js";
import type { Draft } from "../harness-form/index.js";
import { saveDraft } from "../harness-save/index.js";

const ruleDraft = z.object({
  tools: z.array(z.string()),
  paths: z.string(),
  effect: z.string(),
  reason: z.string(),
});

// Every value as the person typed it; the save checks them.
const draft = z
  .object({
    name: z.string(),
    provider: z.string(),
    baseUrl: z.string(),
    model: z.string(),
    maxTurns: z.string(),
    tools: z.array(z.string()),
    root: z.string(),
    rules: z.array(ruleDraft),
    judge: z.boolean(),
    judgeModel: z.string(),
    judgeInstruction: z.string(),
    gate: z.boolean(),
    gateQuestion: z.string(),
  })
  .openapi("HarnessDraft") satisfies z.ZodType<Draft>;

const creation = z.object({ draft }).openapi("HarnessCreation");

const created = z.object({ id: z.string() }).openapi("HarnessCreated");

// `field` names the field of the form the problem shows at.
const refused = z
  .object({
    problems: z.array(
      z.object({ field: z.string(), message: z.string() }),
    ),
  })
  .openapi("HarnessRefused");

const failed = z
  .object({ reason: z.string() })
  .openapi("HarnessFailed");

const json = <Schema extends z.ZodType>(
  schema: Schema,
  description: string,
) => ({
  content: { "application/json": { schema } },
  description,
});

const createHarness = createRoute({
  method: "post",
  path: "/harnesses",
  operationId: "createHarness",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: creation } },
    },
  },
  responses: {
    201: json(created, "The harness was saved."),
    422: json(refused, "The harness has problems and was not saved."),
    500: json(failed, "The harness could not be written."),
  },
});

export const registerHarnessApi = (
  api: OpenAPIHono,
  store: DefinitionStore,
): void => {
  api.openapi(createHarness, async (c) => {
    const body = c.req.valid("json");
    const id = randomUUID();
    const result = await saveDraft(store, id, body.draft);
    switch (result.kind) {
      case "saved":
        return c.json({ id }, 201);
      case "refused":
        return c.json({ problems: result.problems }, 422);
      case "failed":
        return c.json({ reason: result.reason }, 500);
    }
  });
};
