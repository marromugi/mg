import {
  mkdtemp,
  readdir,
  rm,
  writeFile,
  mkdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { HarnessDefinition } from "../definition/index.js";
import { NameTakenError } from "./errors.js";
import { createFileDefinitionStore } from "./file-store.js";

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()?.();
  }
});

const tempDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "mg-definitions-"));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
};

const files: HarnessDefinition = {
  id: "aaa111",
  name: "files",
  provider: { kind: "openrouter" },
  harness: { kind: "loop", model: "m", maxTurns: 10 },
  means: {
    root: "/work",
    tools: ["read_file", "grep"],
    rules: [{ paths: [".env"], allowed: false }],
  },
};

const chat: HarnessDefinition = {
  id: "bbb222",
  name: "chat",
  provider: { kind: "ollama" },
  harness: { kind: "loop", model: "llama3", maxTurns: 5 },
};

describe("file definition store", () => {
  it("lists a stored definition again from a new store on the same folder", async () => {
    const dir = await tempDir();
    await createFileDefinitionStore({ dir }).put(files);

    const listed = await createFileDefinitionStore({ dir }).list();

    expect(listed).toEqual({ definitions: [files], unreadable: [] });
  });

  it("lists definitions sorted by name", async () => {
    const store = createFileDefinitionStore({ dir: await tempDir() });
    await store.put(files);
    await store.put(chat);

    const { definitions } = await store.list();

    expect(definitions.map((definition) => definition.name)).toEqual([
      "chat",
      "files",
    ]);
  });

  it("keeps the same file when a harness is renamed", async () => {
    const dir = await tempDir();
    const store = createFileDefinitionStore({ dir });
    await store.put(files);

    await store.put({ ...files, name: "renamed" });

    expect(await readdir(join(dir)).then((all) => all.sort())).toEqual([
      "aaa111.json",
    ]);
    expect((await store.get("aaa111"))?.name).toBe("renamed");
  });

  it("refuses a name that another id holds", async () => {
    const store = createFileDefinitionStore({ dir: await tempDir() });
    await store.put(files);

    await expect(
      store.put({ ...chat, name: "files" }),
    ).rejects.toBeInstanceOf(NameTakenError);
    expect((await store.list()).definitions).toEqual([files]);
  });

  it("lists a file that does not parse as unreadable and does not open it", async () => {
    const dir = await tempDir();
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "broken.json"), "{not json");
    const store = createFileDefinitionStore({ dir });
    await store.put(files);

    const listed = await store.list();

    expect(listed).toEqual({
      definitions: [files],
      unreadable: ["broken.json"],
    });
    expect(await store.get("broken")).toBeUndefined();
  });

  it("removes the file when a definition is deleted", async () => {
    const dir = await tempDir();
    const store = createFileDefinitionStore({ dir });
    await store.put(files);

    await store.delete("aaa111");

    expect(await readdir(dir)).toEqual([]);
    expect(await store.get("aaa111")).toBeUndefined();
  });

  it("lists nothing when the folder does not exist yet", async () => {
    const dir = join(await tempDir(), "harnesses");

    expect(await createFileDefinitionStore({ dir }).list()).toEqual({
      definitions: [],
      unreadable: [],
    });
  });
});
