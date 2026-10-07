import { Hono } from "hono";
import { createApi } from "./api/index.js";
import type { DefinitionStore } from "./definition-store/index.js";
import { registerApiKeys } from "./routes/api-keys.js";
import { registerHarnesses } from "./routes/harnesses.js";
import { registerHome } from "./routes/home.js";
import { registerRefusals } from "./routes/refusals.js";
import { registerRuns } from "./routes/runs.js";
import { registerStyles } from "./routes/styles.js";
import type { SecretStore } from "./secret-store/index.js";
import type { Session } from "./session.js";
import type { TestRuns } from "./test-run/index.js";

export type AppParts = {
  session: Session;
  dataDir: string;
  definitions: DefinitionStore;
  secrets: SecretStore;
  runs: TestRuns;
};

export const createApp = (parts: AppParts): Hono => {
  const app = new Hono();

  registerRefusals(app);
  registerStyles(app);
  app.use(parts.session.middleware);
  registerHome(app);
  app.route("/api", createApi({ definitions: parts.definitions }));
  registerHarnesses(app, parts.definitions, parts.runs);
  registerRuns(app, parts.runs, parts.dataDir);
  registerApiKeys(app, parts.secrets);

  return app;
};
