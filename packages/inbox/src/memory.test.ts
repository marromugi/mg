import { describeStoreContract } from "./store-contract.test-helper.js";
import { createMemoryInboxStore } from "./memory.js";

describeStoreContract("the in-memory store", async () =>
  createMemoryInboxStore(),
);
