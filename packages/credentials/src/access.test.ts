import { describe, expect, it } from "vitest";
import { createCredentialAccess } from "./access.js";
import {
  CredentialDeniedError,
  CredentialStoreError,
} from "./errors.js";
import type { CredentialStore, CredentialUse } from "./types.js";

const entries = [
  {
    name: "demo",
    origins: ["https://example.com"],
    fields: ["username", "password"],
  },
];

const use: CredentialUse = {
  name: "demo",
  field: "password",
  origin: "https://example.com",
};

const storeOf = (value: string) => {
  const reads: string[] = [];
  const store: CredentialStore = {
    async read(name, field) {
      reads.push(`${name}.${field}`);
      return value;
    },
  };
  return { store, reads };
};

describe("createCredentialAccess", () => {
  it("lists the logins usable at an origin with their fields", () => {
    const access = createCredentialAccess({
      store: storeOf("x").store,
      entries,
      approval: { needed: false },
    });
    expect(access.usableAt("https://example.com")).toEqual([
      { name: "demo", fields: ["username", "password"] },
    ]);
    expect(access.usableAt("https://example.com:8443")).toEqual([]);
  });

  it("gives the value when no approval is needed", async () => {
    const access = createCredentialAccess({
      store: storeOf("hunter2abc").store,
      entries,
      approval: { needed: false },
    });
    expect(await access.use(use)).toBe("hunter2abc");
  });

  it("denies an origin that is not registered and names it", async () => {
    const { store, reads } = storeOf("hunter2abc");
    const access = createCredentialAccess({
      store,
      entries,
      approval: { needed: false },
    });
    const error = await access
      .use({ ...use, origin: "https://evil.example" })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CredentialDeniedError);
    expect((error as Error).message).toBe(
      "demo is not registered for https://evil.example",
    );
    expect(reads).toEqual([]);
  });

  it("denies an unknown login and an unknown field", async () => {
    const access = createCredentialAccess({
      store: storeOf("x").store,
      entries,
      approval: { needed: false },
    });
    await expect(access.use({ ...use, name: "other" })).rejects.toThrow(
      "unknown login: other",
    );
    await expect(
      access.use({ ...use, field: "token" }),
    ).rejects.toThrow("unknown field: demo.token");
  });

  it("asks before reading and denies when approval is refused", async () => {
    const { store, reads } = storeOf("hunter2abc");
    const asked: CredentialUse[] = [];
    const access = createCredentialAccess({
      store,
      entries,
      approval: {
        needed: true,
        ask: async (u) => {
          asked.push(u);
          return false;
        },
      },
    });
    await expect(access.use(use)).rejects.toThrow(
      "approval was refused for demo.password on https://example.com",
    );
    expect(asked).toEqual([use]);
    expect(reads).toEqual([]);
  });

  it("skips the question when the needed function says no", async () => {
    const access = createCredentialAccess({
      store: storeOf("demo-user").store,
      entries,
      approval: {
        needed: (u) => u.field === "password",
        ask: async () => {
          throw new Error("must not ask");
        },
      },
    });
    expect(await access.use({ ...use, field: "username" })).toBe(
      "demo-user",
    );
  });

  it("fails with a store error when the value is empty", async () => {
    const access = createCredentialAccess({
      store: storeOf("").store,
      entries,
      approval: { needed: false },
    });
    const error = await access.use(use).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CredentialStoreError);
    expect((error as Error).message).toBe(
      "the store gave an empty value for demo.password",
    );
  });

  it("rejects duplicate names, empty fields and malformed origins", () => {
    const make = (list: typeof entries) => () =>
      createCredentialAccess({
        store: storeOf("x").store,
        entries: list,
        approval: { needed: false },
      });
    expect(make([...entries, ...entries])).toThrow(TypeError);
    expect(make([{ ...entries[0], fields: [] }])).toThrow(TypeError);
    expect(
      make([{ ...entries[0], origins: ["https://example.com/login"] }]),
    ).toThrow(TypeError);
    expect(make([{ ...entries[0], origins: ["example.com"] }])).toThrow(
      TypeError,
    );
  });

  it("propagates an abort as an abort", async () => {
    const controller = new AbortController();
    controller.abort();
    const access = createCredentialAccess({
      store: storeOf("x").store,
      entries,
      approval: { needed: false },
    });
    await expect(
      access.use(use, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
