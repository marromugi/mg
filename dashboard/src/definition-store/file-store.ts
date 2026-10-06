import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import {
  parseDefinition,
  type HarnessDefinition,
} from "../definition/index.js";
import { NameTakenError } from "./errors.js";
import type { DefinitionStore } from "./store.js";

const EXTENSION = ".json";
const VALID_ID = /^[A-Za-z0-9_-]{1,64}$/;

const isMissing = (error: unknown): boolean =>
  (error as NodeJS.ErrnoException).code === "ENOENT";

const byName = (
  first: HarnessDefinition,
  second: HarnessDefinition,
): number =>
  first.name.localeCompare(second.name) ||
  first.id.localeCompare(second.id);

// Keeps each definition as `<id>.json` in `dir`. The id never changes,
// so renaming a harness rewrites the same file.
export const createFileDefinitionStore = (options: {
  dir: string;
}): DefinitionStore => {
  const fileOf = (id: string): string =>
    join(options.dir, `${id}${EXTENSION}`);

  // Reads one file. Undefined when it is not a definition of this id.
  const readDefinition = async (
    id: string,
  ): Promise<HarnessDefinition | undefined> => {
    let content: string;
    try {
      content = await readFile(fileOf(id), "utf-8");
    } catch {
      return undefined;
    }
    let value: unknown;
    try {
      value = JSON.parse(content);
    } catch {
      return undefined;
    }
    const parsed = parseDefinition(value);
    return parsed.ok && parsed.definition.id === id
      ? parsed.definition
      : undefined;
  };

  const ids = async (): Promise<string[]> => {
    let files: string[];
    try {
      files = await readdir(options.dir);
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
    return files
      .filter((file) => file.endsWith(EXTENSION))
      .map((file) => file.slice(0, -EXTENSION.length));
  };

  // Writes and deletes run one at a time so the name check and the
  // write of one put cannot interleave with another.
  let queue: Promise<unknown> = Promise.resolve();
  const serially = <T>(task: () => Promise<T>): Promise<T> => {
    const result = queue.then(task);
    queue = result.catch(() => undefined);
    return result;
  };

  return {
    list: async () => {
      const definitions: HarnessDefinition[] = [];
      const unreadable: string[] = [];
      for (const id of (await ids()).sort()) {
        const definition = VALID_ID.test(id)
          ? await readDefinition(id)
          : undefined;
        if (definition === undefined)
          unreadable.push(`${id}${EXTENSION}`);
        else definitions.push(definition);
      }
      return { definitions: definitions.sort(byName), unreadable };
    },

    get: async (id) =>
      VALID_ID.test(id) ? readDefinition(id) : undefined,

    put: (definition) =>
      serially(async () => {
        if (!VALID_ID.test(definition.id)) {
          throw new Error(
            `Cannot store a harness under the id ${JSON.stringify(definition.id)}: use letters, digits, - and _ (up to 64)`,
          );
        }
        for (const id of await ids()) {
          if (id === definition.id || !VALID_ID.test(id)) continue;
          const other = await readDefinition(id);
          if (other?.name === definition.name) {
            throw new NameTakenError(definition.name);
          }
        }
        await mkdir(options.dir, { recursive: true });
        const file = fileOf(definition.id);
        const temporary = `${file}.tmp`;
        await writeFile(
          temporary,
          `${JSON.stringify(definition, null, 2)}\n`,
        );
        await rename(temporary, file);
      }),

    delete: (id) =>
      serially(async () => {
        if (!VALID_ID.test(id)) return;
        await rm(fileOf(id), { force: true });
      }),
  };
};
