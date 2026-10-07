import type { DefinitionStore } from "../definition-store/index.js";
import { createApi } from "./api.js";

const unused = (): never => {
  throw new Error("the document is made without calling the store");
};

const NO_STORE: DefinitionStore = {
  list: unused,
  get: unused,
  put: unused,
  delete: unused,
};

// The OpenAPI description of the API, read from its routes. The client
// in `src/api-client` is generated from it.
export const apiDocument = () =>
  createApi({ definitions: NO_STORE }).getOpenAPI31Document({
    openapi: "3.1.0",
    info: { title: "mg dashboard", version: "1" },
  });
