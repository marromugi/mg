import type { Tool } from "@mg/core";

export type ConnectorContext = { signal?: AbortSignal };

export interface Connector {
  readonly kind: string;
  readonly exclusive: readonly string[];
  open(context?: ConnectorContext): Promise<Connection>;
}

export interface Connection {
  readonly tools: readonly Tool[];
  close(): Promise<void>;
}

export interface Endpoint {
  open(context?: ConnectorContext): Promise<OpenEndpoint>;
}

export interface OpenEndpoint {
  readonly host: string;
  readonly port: number;
  // Aborts only when the address stops working before close() has been
  // called, before any connection to the address sees its end because of
  // that. The reason is an error saying why. close() never aborts it.
  readonly lost: AbortSignal;
  close(): Promise<void>;
}

export type Workspace = {
  name: string;
  connectors: readonly Connector[];
};

export type OpenWorkspace = {
  readonly name: string;
  readonly tools: readonly Tool[];
  close(): Promise<void>;
};

export const defineWorkspace = (workspace: Workspace): Workspace =>
  workspace;
