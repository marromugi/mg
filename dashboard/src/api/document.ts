import type { DefinitionStore } from "../definition-store/index.js";
import type { Trials } from "../trial/index.js";
import { createApi } from "./api.js";

const unused = (): never => {
  throw new Error("the document is made without calling its parts");
};

const NO_STORE: DefinitionStore = {
  list: unused,
  get: unused,
  put: unused,
  delete: unused,
};

const NO_TRIALS: Trials = { send: unused };

// The OpenAPI description of the API, read from its routes. The client
// in `src/api-client` is generated from it.
export const apiDocument = (): ReturnType<
  ReturnType<typeof createApi>["getOpenAPI31Document"]
> =>
  createApi({
    definitions: NO_STORE,
    trials: NO_TRIALS,
  }).getOpenAPI31Document({
    openapi: "3.1.0",
    info: { title: "mg dashboard", version: "1" },
  });
