import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { JEV_KEY_VARIABLE } from "./assemble/index.js";
import { startServer } from "./start.js";

const DEFAULT_DATA_DIR = join(
  homedir(),
  "Library",
  "Application Support",
  "mg-dashboard",
);
const MAX_PORT = 65535;

const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};

// `pnpm run start -- --port 1` forwards a literal leading "--", which
// parseArgs would read as the end of the options.
const rawArgs = process.argv.slice(2);
const args = rawArgs[0] === "--" ? rawArgs.slice(1) : rawArgs;

const { values } = parseArgs({
  args,
  options: {
    "data-dir": { type: "string" },
    port: { type: "string" },
    "keychain-service": { type: "string" },
    "exit-when-stdin-closes": { type: "boolean" },
  },
});

const port =
  values.port === undefined ? undefined : Number(values.port);
if (
  port !== undefined &&
  (!Number.isInteger(port) || port < 1 || port > MAX_PORT)
) {
  fail(`Invalid --port value: ${values.port}. Use 1 to ${MAX_PORT}.`);
}

try {
  const started = await startServer({
    dataDir:
      values["data-dir"] === undefined
        ? DEFAULT_DATA_DIR
        : resolve(values["data-dir"]),
    port,
    keychainService: values["keychain-service"],
    jevApiKey: process.env[JEV_KEY_VARIABLE] || undefined,
  });
  console.log(started.launchLink);
  if (values["exit-when-stdin-closes"] === true) {
    // A parent that holds the pipe open ends the server by dying.
    process.stdin.resume();
    process.stdin.on(
      "end",
      () => void started.close().then(() => process.exit(0)),
    );
  }
  process.on(
    "SIGINT",
    () => void started.close().then(() => process.exit(0)),
  );
  process.on(
    "SIGTERM",
    () => void started.close().then(() => process.exit(0)),
  );
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
