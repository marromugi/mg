import { Hono } from "hono";
import { createApi } from "./api/index.js";
import type { DefinitionStore } from "./definition-store/index.js";
import { registerAssets } from "./routes/assets.js";
import { registerHarnesses } from "./routes/harnesses.js";
import { registerHome } from "./routes/home.js";
import { registerRefusals } from "./routes/refusals.js";
import type { Session } from "./session.js";
import type { Trials } from "./trial/index.js";

export type AppParts = {
  session: Session;
  definitions: DefinitionStore;
  trials: Trials;
};

export const createApp = (parts: AppParts): Hono => {
  const app = new Hono();

  registerRefusals(app);
  registerAssets(app);
  app.use(parts.session.middleware);
  registerHome(app);
  app.route(
    "/api",
    createApi({ definitions: parts.definitions, trials: parts.trials }),
  );
  registerHarnesses(app, parts.definitions);

  return app;
};
