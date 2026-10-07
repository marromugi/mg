import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { getRequestListener } from "@hono/node-server";
import { createJevEstimator } from "@mg/core";
import { createApp } from "./app.js";
import { createFileDefinitionStore } from "./definition-store/index.js";
import { createKeychainSecretStore } from "./secret-store/index.js";
import { createSession } from "./session.js";
import { createTestRuns } from "./test-run/index.js";

const HOST = "127.0.0.1";
const DEFAULT_KEYCHAIN_SERVICE = "mg-dashboard";

export type StartedServer = {
  launchLink: string;
  close: () => Promise<void>;
};

const reason = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

// Listens before building the app because the session needs the
// address, and a free port is only known once the socket is bound.
export const startServer = async (options: {
  dataDir: string;
  port?: number;
  keychainService?: string;
  // The key for Jev, which judges the gates. Without it a harness with
  // a gate does not run.
  jevApiKey?: string;
}): Promise<StartedServer> => {
  try {
    await mkdir(options.dataDir, { recursive: true });
  } catch (error) {
    throw new Error(
      `Cannot create the data folder ${options.dataDir}: ${reason(error)}`,
      { cause: error },
    );
  }

  const server = createServer();
  const requested = options.port ?? 0;
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(requested, HOST, () => {
        server.off("error", reject);
        resolve();
      });
    });
  } catch (error) {
    throw new Error(
      `Cannot listen on ${HOST}:${requested}: ${reason(error)}`,
      { cause: error },
    );
  }

  const { port } = server.address() as AddressInfo;
  const address = `${HOST}:${port}`;
  const token = randomBytes(32).toString("base64url");
  const secrets = createKeychainSecretStore({
    service: options.keychainService ?? DEFAULT_KEYCHAIN_SERVICE,
  });
  const app = createApp({
    session: createSession({ token, address }),
    dataDir: options.dataDir,
    definitions: createFileDefinitionStore({
      dir: join(options.dataDir, "harnesses"),
    }),
    secrets,
    runs: createTestRuns({
      secrets,
      dataDir: options.dataDir,
      jev:
        options.jevApiKey === undefined
          ? undefined
          : createJevEstimator({ apiKey: options.jevApiKey }),
    }),
  });
  server.on("request", getRequestListener(app.fetch));

  return {
    launchLink: `http://${address}/enter?token=${token}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) =>
          error === undefined ? resolve() : reject(error),
        );
        server.closeAllConnections();
      }),
  };
};
