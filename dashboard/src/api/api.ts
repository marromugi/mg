import { OpenAPIHono } from "@hono/zod-openapi";
import type { DefinitionStore } from "../definition-store/index.js";
import type { Trials } from "../trial/index.js";
import { registerHarnessApi } from "./harnesses.js";
import { registerTrialApi } from "./trial.js";

export type ApiParts = { definitions: DefinitionStore; trials: Trials };

// The JSON API the pages call from the browser, mounted under `/api`.
export const createApi = (parts: ApiParts): OpenAPIHono => {
  const api = new OpenAPIHono();
  registerHarnessApi(api, parts.definitions);
  registerTrialApi(api, parts.definitions, parts.trials);
  return api;
};
