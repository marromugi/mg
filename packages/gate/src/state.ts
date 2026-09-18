import type { GateRequest } from "./types.js";

export const toStateText = (request: GateRequest): string =>
  `Kind: ${request.kind}\n${request.description}`;
