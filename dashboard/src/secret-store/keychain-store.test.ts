import { describe, expect, it } from "vitest";
import { createKeychainSecretStore } from "./keychain-store.js";
import type { SpawnFunction, SpawnResult } from "./spawn.js";

type Call = { command: string; args: readonly string[]; stdin: string };

// A `spawn` that records what it was asked to run and answers with the
// next prepared result.
const fakeSpawn = (...results: (SpawnResult | Error)[]) => {
  const calls: Call[] = [];
  const spawn: SpawnFunction = (command, args, stdin) => {
    calls.push({ command, args, stdin });
    const next = results.shift() ?? {
      exitCode: 0,
      stdout: "",
      stderr: "",
    };
    return next instanceof Error
      ? Promise.reject(next)
      : Promise.resolve(next);
  };
  return { spawn, calls };
};

const ok = (stderr = ""): SpawnResult => ({
  exitCode: 0,
  stdout: "",
  stderr,
});

const failed = (exitCode: number, stderr: string): SpawnResult => ({
  exitCode,
  stdout: "",
  stderr,
});

const SERVICE = "mg-dashboard-test";

describe("keychain secret store", () => {
  it("writes the value on stdin as hex and keeps it out of the arguments", async () => {
    const { spawn, calls } = fakeSpawn(ok());
    const store = createKeychainSecretStore({
      service: SERVICE,
      spawn,
    });

    await store.set("OPENROUTER_API_KEY", "verify-123");

    expect(calls).toEqual([
      {
        command: "/usr/bin/security",
        args: ["-i"],
        stdin:
          'add-generic-password -U -s "mg-dashboard-test" -a "OPENROUTER_API_KEY" -X 7665726966792d313233\n',
      },
    ]);
  });

  it("reads a plain value back from the password line", async () => {
    const { spawn, calls } = fakeSpawn(
      ok('keychain: "/x"\npassword: "verify-123"\n'),
    );
    const store = createKeychainSecretStore({
      service: SERVICE,
      spawn,
    });

    const value = await store.get("OPENROUTER_API_KEY");

    expect(value).toBe("verify-123");
    expect(calls[0]?.args).toEqual([
      "find-generic-password",
      "-s",
      "mg-dashboard-test",
      "-a",
      "OPENROUTER_API_KEY",
      "-g",
    ]);
  });

  it("reads a value that is not plain text back from its hex form", async () => {
    const { spawn } = fakeSpawn(
      ok('password: 0xE697A5E69CACE8AA9E  "\\346\\227\\245"\n'),
    );
    const store = createKeychainSecretStore({
      service: SERVICE,
      spawn,
    });

    expect(await store.get("OPENROUTER_API_KEY")).toBe("日本語");
  });

  it("gives undefined for a key that is not in the Keychain", async () => {
    const { spawn } = fakeSpawn(failed(44, "could not be found"));
    const store = createKeychainSecretStore({
      service: SERVICE,
      spawn,
    });

    expect(await store.get("OPENROUTER_API_KEY")).toBeUndefined();
  });

  it("tells whether a key is set from the exit code", async () => {
    const { spawn } = fakeSpawn(ok(), failed(44, "could not be found"));
    const store = createKeychainSecretStore({
      service: SERVICE,
      spawn,
    });

    expect(await store.has("OPENROUTER_API_KEY")).toBe(true);
    expect(await store.has("OPENROUTER_API_KEY")).toBe(false);
  });

  it("deletes a key that is not in the Keychain without failing", async () => {
    const { spawn } = fakeSpawn(failed(44, "could not be found"));
    const store = createKeychainSecretStore({
      service: SERVICE,
      spawn,
    });

    await expect(
      store.delete("OPENROUTER_API_KEY"),
    ).resolves.toBeUndefined();
  });

  it("fails with the exit code and stderr, and with the value removed", async () => {
    const { spawn } = fakeSpawn(
      failed(36, "User interaction is not allowed. verify-123"),
    );
    const store = createKeychainSecretStore({
      service: SERVICE,
      spawn,
    });

    await expect(
      store.set("OPENROUTER_API_KEY", "verify-123"),
    ).rejects.toThrow(
      "Keychain write of OPENROUTER_API_KEY failed (exit 36): User interaction is not allowed. [removed]",
    );
  });

  it("fails naming the program when it cannot be started", async () => {
    const { spawn } = fakeSpawn(new Error("spawn ENOENT"));
    const store = createKeychainSecretStore({
      service: SERVICE,
      spawn,
    });

    await expect(store.has("OPENROUTER_API_KEY")).rejects.toThrow(
      "Keychain lookup of OPENROUTER_API_KEY failed: cannot run /usr/bin/security: spawn ENOENT",
    );
  });
});
