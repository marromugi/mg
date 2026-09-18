import type { Tool } from "@mg/core";
import {
  ConnectorOpenError,
  DuplicateToolNameError,
  WorkspaceCloseError,
} from "./errors.js";
import type {
  Connection,
  ConnectorContext,
  OpenWorkspace,
  Workspace,
} from "./types.js";

const isAbortError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  (error as { name?: unknown }).name === "AbortError";

const closeAllSilently = async (
  connections: readonly Connection[],
): Promise<void> => {
  for (let index = connections.length - 1; index >= 0; index -= 1) {
    try {
      await connections[index].close();
    } catch {
      // 開く処理の失敗を投げるのが優先なので、閉じる失敗はここでは無視します。
    }
  }
};

export const openWorkspace = async (
  workspace: Workspace,
  context?: ConnectorContext,
): Promise<OpenWorkspace> => {
  const connections: Connection[] = [];

  for (const [index, connector] of workspace.connectors.entries()) {
    context?.signal?.throwIfAborted();
    try {
      connections.push(await connector.open(context));
    } catch (error) {
      await closeAllSilently(connections);
      if (isAbortError(error)) {
        throw error;
      }
      throw new ConnectorOpenError(connector.kind, index, {
        cause: error,
      });
    }
  }

  const tools: Tool[] = [];
  const kindsByToolName = new Map<string, string[]>();
  connections.forEach((connection, index) => {
    const kind = workspace.connectors[index].kind;
    for (const tool of connection.tools) {
      tools.push(tool);
      const kinds = kindsByToolName.get(tool.name);
      if (kinds === undefined) {
        kindsByToolName.set(tool.name, [kind]);
      } else {
        kinds.push(kind);
      }
    }
  });

  for (const [toolName, kinds] of kindsByToolName) {
    if (kinds.length > 1) {
      await closeAllSilently(connections);
      throw new DuplicateToolNameError(toolName, kinds);
    }
  }

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) {
      return;
    }
    closed = true;

    const errors: unknown[] = [];
    for (let index = connections.length - 1; index >= 0; index -= 1) {
      try {
        await connections[index].close();
      } catch (error) {
        errors.push(error);
      }
    }

    if (errors.length > 0) {
      throw new WorkspaceCloseError(errors);
    }
  };

  return { name: workspace.name, tools, close };
};
