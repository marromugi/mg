import { expect, test } from "vitest";
import { ConversationNotFoundError } from "./errors.js";
import { createMemoryConversationStore } from "./memory.js";
import { describeStoreContract } from "./store-contract.test-helper.js";

describeStoreContract("createMemoryConversationStore", async () =>
  createMemoryConversationStore(),
);

test("does not share conversations between separately created stores", async () => {
  const first = createMemoryConversationStore();
  const second = createMemoryConversationStore();
  await first.create("jev");

  const promise = second.read("jev", { kind: "all" });

  await expect(promise).rejects.toBeInstanceOf(
    ConversationNotFoundError,
  );
});
