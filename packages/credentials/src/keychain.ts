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
            "-w",
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
          `the security command failed for ${label} with exit code ${result.code}: ${result.stderr.trim()}`,
        );
      }
      return result.stdout.replace(/\r?\n$/, "");
    },
  };
};
