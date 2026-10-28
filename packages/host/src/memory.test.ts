import { createMemoryReplyLog } from "./memory.js";
import { describeReplyLogContract } from "./reply-log-contract.test-helper.js";

describeReplyLogContract("the in-memory log", async () =>
  createMemoryReplyLog(),
);
