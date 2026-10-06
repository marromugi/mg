import { execFile } from "node:child_process";
import { CredentialStoreError } from "./errors.js";
import type { CredentialContext, CredentialStore } from "./types.js";

export type KeychainExecResult = {
  code: number;
  stdout: string;
  stderr: string;
};

export type KeychainExec = (
  command: string,
  args: readonly string[],
  context?: CredentialContext,
) => Promise<KeychainExecResult>;

// security コマンドが「該当する項目がない」ときに返す終了コードです。
const NOT_FOUND = 44;

const execSecurity: KeychainExec = (command, args, context) =>
  new Promise((resolve, reject) => {
    execFile(
      command,
      [...args],
      { signal: context?.signal, encoding: "utf8" },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ code: 0, stdout, stderr });
        } else if (typeof error.code === "number") {
          resolve({ code: error.code, stdout: "", stderr });
        } else {
          reject(error);
        }
      },
    );
  });

// -g は値を標準エラーに書きます。印字できる ASCII は `password: "値"`、
// 非 ASCII や改行を含む値は `password: 0x<hex>  "..."` です。
// -w は後者を hex だけで返すので、hex に見える本物の値と区別できません。
const parsePassword = (stderr: string): string | undefined => {
  const line = stderr
    .split("\n")
    .find((l) => l.startsWith("password: "));
  if (line === undefined) return undefined;
  const rest = line.slice("password: ".length);
  if (rest.length >= 2 && rest.startsWith('"') && rest.endsWith('"')) {
    return rest.slice(1, -1);
  }
  const hex = /^0x([0-9A-Fa-f]*)(?:\s|$)/.exec(rest)?.[1];
  if (hex === undefined || hex.length % 2 !== 0) return undefined;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.from(hex, "hex"),
    );
  } catch {
    return undefined;
  }
};

export const createKeychainStore = (
  options: { service: string },
  deps: { exec?: KeychainExec; platform?: string } = {},
): CredentialStore => {
  const exec = deps.exec ?? execSecurity;
  const platform = deps.platform ?? process.platform;

  return {
    async read(name, field, context) {
      const label = `${name}.${field}`;
      if (platform !== "darwin") {
        throw new CredentialStoreError(
          `the Keychain store works only on macOS (this is ${platform})`,
        );
      }
      context?.signal?.throwIfAborted();
      let result: KeychainExecResult;
      try {
        result = await exec(
          "security",
          [
            "find-generic-password",
            "-s",
            options.service,
            "-a",
            `${name}/${field}`,
            "-g",
          ],
          context,
        );
      } catch (error) {
        if (context?.signal?.aborted) throw error;
        throw new CredentialStoreError(
          `could not run the security command for ${label}`,
        );
      }
      if (result.code === NOT_FOUND) {
        throw new CredentialStoreError(
          `the store has no value for ${label}`,
        );
      }
      if (result.code !== 0) {
        throw new CredentialStoreError(
          `the security command failed for ${label} with exit code ${result.code}`,
        );
      }
      const value = parsePassword(result.stderr);
      if (value === undefined) {
        throw new CredentialStoreError(
          `could not read the value of ${label} from the security output`,
        );
      }
      return value;
    },
  };
};
