import { PersonaExistsError } from "@mg/memory";
import { openSqliteMemoryStore } from "@mg/memory/sqlite";
import { outputPath } from "./outputs.ts";

// The one person the sample persona talks with.
export const COUNTERPARTS = [{ id: "user", name: "User" }];

// Opens the file the sample persona keeps its memory in, and starts the
// persona's memory there when the file does not have it yet.
export const openSamplePersonaMemory = async (): Promise<
  Awaited<ReturnType<typeof openSqliteMemoryStore>>
> => {
  const store = await openSqliteMemoryStore(
    outputPath("persona-memory.sqlite"),
  );
  try {
    await store.create("jev", "I am Jev.");
  } catch (error) {
    if (!(error instanceof PersonaExistsError)) {
      await store.close();
      throw error;
    }
  }
  return store;
};
