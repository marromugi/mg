import { SecretStoreError, SecretTooLongError } from "./errors.js";
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

// `security -i` reads a line in pieces of 4095 characters; a command
// longer than that is run in two parts. A command that fits is read
// whole.
const MAX_COMMAND_LENGTH = 4095;
const MIN_FRAGMENT = 4;

// Text that `security` printed during a write, with everything that
// could carry the value or its hex taken out, whatever the wording:
// quoted text, long runs of hex digits, and any run of MIN_FRAGMENT or
// more characters that is part of the value or of its hex.
const withoutValue = (text: string, value: string): string => {
  const secrets = [
    value.toLowerCase(),
    Buffer.from(value, "utf-8").toString("hex"),
  ];
  const stripped = text
    .replace(/"[^"]*"/g, `"${REMOVED}"`)
    .replace(/[0-9A-Fa-f]{8,}/g, REMOVED);
  const lower = stripped.toLowerCase();
  let result = "";
  let index = 0;
  while (index < stripped.length) {
    let length = 0;
    for (const secret of secrets) {
      let candidate = MIN_FRAGMENT;
      while (
        index + candidate <= lower.length &&
        secret.includes(lower.slice(index, index + candidate))
      ) {
        length = Math.max(length, candidate);
        candidate += 1;
      }
    }
    if (length === 0) {
      result += stripped[index];
      index += 1;
    } else {
      result += REMOVED;
      index += length;
    }
  }
  return result;
};

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
    const stderr =
      value === undefined
        ? result.stderr.trim()
        : withoutValue(result.stderr.trim(), value);
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
      const head = [
        "add-generic-password",
        "-U",
        "-s",
        quoted(options.service),
        "-a",
        quoted(name),
        "-X",
        "",
      ].join(" ");
      const maxBytes = Math.floor(
        (MAX_COMMAND_LENGTH - Buffer.byteLength(head)) / 2,
      );
      if (Buffer.byteLength(value) > maxBytes) {
        throw new SecretTooLongError(maxBytes);
      }
      const command =
        head + Buffer.from(value, "utf-8").toString("hex");
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
