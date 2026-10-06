import { Hono } from "hono";
import { registerApiKeys } from "./routes/api-keys.js";
import { registerHarnesses } from "./routes/harnesses.js";
import { registerHome } from "./routes/home.js";
import { registerRefusals } from "./routes/refusals.js";
import { registerStyles } from "./routes/styles.js";
import type { Session } from "./session.js";

export type AppParts = {
  session: Session;
  dataDir: string;
};

export const createApp = (parts: AppParts): Hono => {
  const app = new Hono();

  registerRefusals(app);
  registerStyles(app);
  app.use(parts.session.middleware);
  registerHome(app);
  registerHarnesses(app);
  registerApiKeys(app);

  return app;
};
