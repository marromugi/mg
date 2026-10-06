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
  it("reads one generic-password item per field", async () => {
    const calls: unknown[][] = [];
    const store = createKeychainStore(
      { service: "mg" },
      {
        exec: execOf({ code: 0, stderr: 'password: "hunter2abc"\n' })(
          calls,
        ),
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
        "-g",
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
      "the security command failed for demo.password with exit code 1",
    );
  });

  it("gives the true value of one that the security command prints as hex", async () => {
    const store = createKeychainStore(
      { service: "mg" },
      {
        exec: execOf({
          code: 0,
          stderr:
            'password: 0x70C3A47373776F7264  "p\\303\\244ssword"\n',
        })([]),
        platform: "darwin",
      },
    );
    expect(await store.read("demo", "password")).toBe("pässword");
  });

  it("fails without a guess when the security output cannot be read", async () => {
    const store = createKeychainStore(
      { service: "mg" },
      {
        exec: execOf({ code: 0, stderr: "password: 0x70C3A4zz\n" })([]),
        platform: "darwin",
      },
    );
    await expect(store.read("demo", "password")).rejects.toThrow(
      "could not read the value of demo.password from the security output",
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
