import type { Tool } from "@mg/core";
import type { TraceSpan } from "@mg/harness";
import { noopSpan } from "@mg/harness";
import { ATTR, jsonAttribute, SPAN } from "@mg/trace";
import type { OpenWorkspace, Workspace } from "@mg/workspace";
import { DuplicateToolNameError, openWorkspace } from "@mg/workspace";

export type WorkspaceScopeContext = {
  trace: TraceSpan;
  signal?: AbortSignal;
};

const successBeforeCloseFailure = new WeakMap<object, unknown>();

export const resultBeforeCloseFailure = (error: unknown): unknown =>
  typeof error === "object" && error !== null
    ? successBeforeCloseFailure.get(error)
    : undefined;

export const withWorkspace = async <T>(
  workspace: Workspace | undefined,
  context: WorkspaceScopeContext,
  fn: (opened: OpenWorkspace | undefined) => Promise<T>,
): Promise<T> => {
  if (!workspace) {
    return fn(undefined);
  }

  let workspaceSpan: TraceSpan = noopSpan;
  try {
    workspaceSpan = context.trace.startSpan(SPAN.workspace, {
      [ATTR.op]: "workspace",
      [ATTR.workspaceName]: workspace.name,
      [ATTR.workspaceConnectors]: jsonAttribute(
        workspace.connectors.map((connector) => connector.kind),
      ),
    });
  } catch {
    workspaceSpan = noopSpan;
  }

  let opened: OpenWorkspace;
  try {
    opened = await openWorkspace(workspace, { signal: context.signal });
  } catch (error) {
    workspaceSpan.end(error);
    throw error;
  }

  workspaceSpan.setAttributes({
    [ATTR.workspaceTools]: jsonAttribute(
      opened.tools.map((tool) => tool.name),
    ),
  });

  let result: T;
  try {
    result = await fn(opened);
  } catch (error) {
    try {
      await opened.close();
      workspaceSpan.end();
    } catch (closeError) {
      workspaceSpan.end(closeError);
    }
    throw error;
  }

  try {
    await opened.close();
  } catch (closeError) {
    workspaceSpan.end(closeError);
    if (typeof closeError === "object" && closeError !== null) {
      successBeforeCloseFailure.set(closeError, result);
    }
    throw closeError;
  }
  workspaceSpan.end();
  return result;
};

export const mergeWorkspaceTools = (
  configTools: readonly Tool[],
  opened: OpenWorkspace | undefined,
): readonly Tool[] => {
  if (!opened) {
    return configTools;
  }

  const configToolNames = new Set(configTools.map((tool) => tool.name));
  const duplicate = opened.tools.find((tool) =>
    configToolNames.has(tool.name),
  );
  if (duplicate) {
    throw new DuplicateToolNameError(duplicate.name, [
      "config",
      opened.name,
    ]);
  }

  return [...configTools, ...opened.tools];
};
