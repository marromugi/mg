import { OpenAPIHono } from "@hono/zod-openapi";
import type { DefinitionStore } from "../definition-store/index.js";
import { registerHarnessApi } from "./harnesses.js";

export type ApiParts = { definitions: DefinitionStore };

// The JSON API the pages call from the browser, mounted under `/api`.
export const createApi = (parts: ApiParts): OpenAPIHono => {
  const api = new OpenAPIHono();
  registerHarnessApi(api, parts.definitions);
  return api;
};
