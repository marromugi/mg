import { expect, test } from "vitest";
import { PersonaNotFoundError } from "./errors.js";
import { createMemoryStore } from "./memory.js";
import * as storeContract from "./store-contract.test-helper.js";

storeContract.describeMemoryStoreContract(
  "createMemoryStore",
  async () => createMemoryStore(),
);

test("does not share personas between separately created stores", async () => {
  const first = createMemoryStore();
  const second = createMemoryStore();
  await first.create("jev", "I am Jev.");

  const promise = second.read("jev", { counterparts: [] });

  await expect(promise).rejects.toBeInstanceOf(PersonaNotFoundError);
});
