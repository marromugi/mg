import { describe, expect, it } from "vitest";
import { CredentialStoreError } from "./errors.js";
import { createKeychainStore, type KeychainExec } from "./keychain.js";

const execOf =
  (result: { code: number; stdout?: string; stderr?: string }) =>
  (calls: unknown[][]): KeychainExec =>
  async (command, args) => {
    calls.push([command, ...args]);
    return { stdout: "", stderr: "", ...result };
  };

describe("createKeychainStore", () => {
  it("reads one generic-password item per field and trims the newline", async () => {
    const calls: unknown[][] = [];
    const store = createKeychainStore(
      { service: "mg" },
      {
        exec: execOf({ code: 0, stdout: "hunter2abc\n" })(calls),
        platform: "darwin",
      },
    );
    expect(await store.read("demo", "password")).toBe("hunter2abc");
    expect(calls).toEqual([
      [
        "security",
        "find-generic-password",
        "-s",
        "mg",
        "-a",
        "demo/password",
        "-w",
      ],
    ]);
  });

  it("fails with a store error when the item is missing", async () => {
    const store = createKeychainStore(
      { service: "mg" },
      { exec: execOf({ code: 44 })([]), platform: "darwin" },
    );
    const error = await store
      .read("demo", "username")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CredentialStoreError);
    expect((error as Error).message).toBe(
      "the store has no value for demo.username",
    );
  });

  it("fails with the exit code when security fails", async () => {
    const store = createKeychainStore(
      { service: "mg" },
      {
        exec: execOf({ code: 1, stderr: "denied\n" })([]),
        platform: "darwin",
      },
    );
    await expect(store.read("demo", "password")).rejects.toThrow(
      "the security command failed for demo.password with exit code 1: denied",
    );
  });

  it("fails on a platform other than macOS without running anything", async () => {
    const calls: unknown[][] = [];
    const store = createKeychainStore(
      { service: "mg" },
      { exec: execOf({ code: 0 })(calls), platform: "linux" },
    );
    await expect(store.read("demo", "password")).rejects.toThrow(
      "the Keychain store works only on macOS (this is linux)",
    );
    expect(calls).toEqual([]);
  });
});
