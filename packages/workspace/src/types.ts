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
