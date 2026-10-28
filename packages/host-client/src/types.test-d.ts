import type { ReplyRecord as HostRecord } from "@mg/host";
import type { ReplyRecord } from "./types.js";

// Fail to compile when the host's record changes and this copy does not.
declare const mine: ReplyRecord;
declare const theirs: HostRecord;
export const asHost: HostRecord = mine;
export const asClient: ReplyRecord = theirs;
