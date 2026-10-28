import { createHash, timingSafeEqual } from "node:crypto";
import {
  DuplicateClientTokenError,
  EmptyClientTokenError,
} from "./errors.js";
import type { Client } from "./types.js";

const digest = (token: string): Buffer =>
  createHash("sha256").update(token).digest();

/**
 * Returns the client whose token an `Authorization: Bearer` header
 * carries, or undefined. Every client is compared, so the time taken
 * does not show which one matched.
 */
export const createAdmission = (
  clients: readonly Client[],
): ((header: string | undefined) => Client | undefined) => {
  const known = new Map<string, string>();
  for (const client of clients) {
    if (client.token === "") {
      throw new EmptyClientTokenError(client.name);
    }
    const hash = digest(client.token).toString("hex");
    const other = known.get(hash);
    if (other !== undefined) {
      throw new DuplicateClientTokenError(other, client.name);
    }
    known.set(hash, client.name);
  }
  const hashed = clients.map((client) => ({
    client,
    hash: digest(client.token),
  }));
  return (header) => {
    const match = /^Bearer (.+)$/.exec(header ?? "");
    const presented = digest(match?.[1] ?? "");
    let admitted: Client | undefined;
    for (const { client, hash } of hashed) {
      if (timingSafeEqual(hash, presented) && match !== null) {
        admitted = client;
      }
    }
    return admitted;
  };
};
