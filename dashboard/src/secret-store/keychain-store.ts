import { SecretStoreError } from "./errors.js";
import {
  spawnProcess,
  type SpawnFunction,
  type SpawnResult,
} from "./spawn.js";
import type { SecretStore } from "./store.js";

const SECURITY = "/usr/bin/security";
const NOT_FOUND = 44;
const REMOVED = "[removed]";
const PASSWORD_PREFIX = "password: ";

// `security` quotes with double quotes and a backslash escape.
const quoted = (text: string): string =>
  `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

// With -g, `security` prints the stored bytes as
// `password: 0x<hex>  "<text>"` when they are not plain printable
// text, and as `password: "<text>"` when they are. Plain text holds
// no quote and no backslash.
const passwordFrom = (output: string): string | undefined => {
  const line = output
    .split("\n")
    .find((candidate) => candidate.startsWith(PASSWORD_PREFIX));
  if (line === undefined) return undefined;
  const rest = line.slice(PASSWORD_PREFIX.length);
  const hex = /^0x([0-9A-Fa-f]*)(?:\s|$)/.exec(rest);
  if (hex !== null) {
    return Buffer.from(hex[1] ?? "", "hex").toString("utf-8");
  }
  return /^"(.*)"$/.exec(rest)?.[1];
};

// Keeps secrets as generic passwords in the macOS Keychain: the service
// is `service` and the account is the secret's name. Everything that
// belongs to `security` stays in here, including how a value reaches it.
export const createKeychainSecretStore = (options: {
  service: string;
  spawn?: SpawnFunction;
}): SecretStore => {
  const spawn = options.spawn ?? spawnProcess;

  const run = async (
    describe: string,
    args: readonly string[],
    stdin = "",
  ): Promise<SpawnResult> => {
    try {
      return await spawn(SECURITY, args, stdin);
    } catch (error) {
      throw new SecretStoreError(
        `${describe} failed: cannot run ${SECURITY}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error },
      );
    }
  };

  const failure = (
    describe: string,
    result: SpawnResult,
    value?: string,
  ): SecretStoreError => {
    let stderr = result.stderr.trim();
    if (value !== undefined && value !== "") {
      const hex = Buffer.from(value, "utf-8").toString("hex");
      stderr = stderr
        .replaceAll(value, REMOVED)
        .replaceAll(hex, REMOVED)
        .replaceAll(hex.toUpperCase(), REMOVED);
    }
    return new SecretStoreError(
      `${describe} failed (exit ${result.exitCode}): ${stderr}`,
    );
  };

  return {
    has: async (name) => {
      const describe = `Keychain lookup of ${name}`;
      const result = await run(describe, [
        "find-generic-password",
        "-s",
        options.service,
        "-a",
        name,
      ]);
      if (result.exitCode === 0) return true;
      if (result.exitCode === NOT_FOUND) return false;
      throw failure(describe, result);
    },

    get: async (name) => {
      const describe = `Keychain read of ${name}`;
      const result = await run(describe, [
        "find-generic-password",
        "-s",
        options.service,
        "-a",
        name,
        "-g",
      ]);
      if (result.exitCode === NOT_FOUND) return undefined;
      if (result.exitCode !== 0) throw failure(describe, result);
      const value = passwordFrom(result.stderr);
      if (value === undefined) {
        throw new SecretStoreError(
          `${describe} failed: the security output had no readable password`,
        );
      }
      return value;
    },

    // The command goes to `security -i` on stdin, so the value is never
    // in the argument list. It is written as hex (-X), which needs no
    // quoting and keeps every character intact.
    set: async (name, value) => {
      const describe = `Keychain write of ${name}`;
      const command = [
        "add-generic-password",
        "-U",
        "-s",
        quoted(options.service),
        "-a",
        quoted(name),
        "-X",
        Buffer.from(value, "utf-8").toString("hex"),
      ].join(" ");
      const result = await run(describe, ["-i"], `${command}\n`);
      if (result.exitCode !== 0) throw failure(describe, result, value);
    },

    delete: async (name) => {
      const describe = `Keychain delete of ${name}`;
      const result = await run(describe, [
        "delete-generic-password",
        "-s",
        options.service,
        "-a",
        name,
      ]);
      if (result.exitCode === 0 || result.exitCode === NOT_FOUND)
        return;
      throw failure(describe, result);
    },
  };
};
