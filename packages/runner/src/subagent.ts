import type { Message, Tool } from "@mg/core";
import { textOf } from "@mg/core";
import { collect, noopSpan } from "@mg/harness";
import type {
  HarnessResult,
  Subagent,
  SubagentContext,
} from "@mg/harness";
import type { OpenWorkspace } from "@mg/workspace";
import { exclusiveNamesOf } from "@mg/workspace";
import { z } from "zod";
import { InvalidRunConfigError, SubagentCloseError } from "./errors.js";
import type { ExclusiveNames } from "./exclusive-names.js";
import { createHarness } from "./harness.js";
import type {
  SubagentConfig,
  SubagentWorkspace,
  SubagentWorkspaceSource,
} from "./subagent-config.js";
import {
  mergeWorkspaceTools,
  withWorkspace,
} from "./workspace-scope.js";

const promptField = z
  .string()
  .describe(
    "The task for the subagent. It starts with no memory of this conversation, so include everything it needs.",
  );

const lastAssistantText = (messages: readonly Message[]): string => {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message?.role === "assistant") return textOf(message);
  }
  return "";
};

const finishedText = (text: string): string =>
  text === ""
    ? "[empty] The subagent finished without a final message."
    : text;

const maxTurnsText = (maxTurns: number, text: string): string => {
  const prefix = `[incomplete] The subagent reached its turn limit of ${maxTurns} before finishing. No final answer was produced. Its last message before the limit`;
  return text === ""
    ? `${prefix} was empty.`
    : `${prefix} follows:\n${text}`;
};

const lengthText = (text: string): string => {
  const prefix =
    "[incomplete] The subagent's output was cut off at the model's length limit. The cut-off text";
  return text === ""
    ? `${prefix} was empty.`
    : `${prefix} follows:\n${text}`;
};

const finalTextOf = (
  result: HarnessResult,
  maxTurns: number,
): string => {
  const text = lastAssistantText(result.messages);
  switch (result.reason) {
    case "stop":
      return finishedText(text);
    case "max-turns":
      return maxTurnsText(maxTurns, text);
    case "length":
      return lengthText(text);
  }
};

const namesOf = (
  configName: string,
  sources: readonly SubagentWorkspaceSource[],
  parentName: string | undefined,
): string[] =>
  sources.map((source) => {
    if (source.kind === "own") return source.workspace.name;
    if (parentName === undefined) {
      throw new InvalidRunConfigError(
        `subagent "${configName}"`,
        `source "parent" needs a workspace on the run`,
      );
    }
    return parentName;
  });

const validateWorkspace = (
  configName: string,
  workspace: SubagentWorkspace | undefined,
  parentName: string | undefined,
): void => {
  if (!workspace) return;

  const sources =
    workspace.pick === "fixed" ? [workspace.source] : workspace.sources;
  const names = namesOf(configName, sources, parentName);
  if (workspace.pick !== "caller") return;

  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) {
      throw new InvalidRunConfigError(
        `subagent "${configName}"`,
        `workspace name "${name}" is listed more than once`,
      );
    }
    seen.add(name);
  }
};

const validateHeldNames = (
  configName: string,
  workspace: SubagentWorkspace | undefined,
  parentHeldNames: readonly string[],
): void => {
  if (!workspace) return;

  const sources =
    workspace.pick === "fixed" ? [workspace.source] : workspace.sources;
  const parentHeld = new Set(parentHeldNames);
  for (const source of sources) {
    if (source.kind !== "own") continue;
    const overlap = exclusiveNamesOf(source.workspace).find((name) =>
      parentHeld.has(name),
    );
    if (overlap === undefined) continue;
    throw new InvalidRunConfigError(
      `subagent "${configName}"`,
      `workspace "${source.workspace.name}" holds "${overlap}", which the run's workspace holds for the whole run`,
    );
  }
};

const sourceSentence = (
  source: SubagentWorkspaceSource,
  name: string,
): string =>
  source.kind === "parent"
    ? `"${name}": the workspace you are using now; the subagent shares its state with you.`
    : `"${name}": a separate workspace, opened for this call and closed when it ends.`;

const buildInputSchema = (
  configName: string,
  workspace: SubagentWorkspace | undefined,
  parentName: string | undefined,
) => {
  if (!workspace || workspace.pick === "fixed") {
    return z.object({ prompt: promptField });
  }

  const names = namesOf(configName, workspace.sources, parentName);
  const sentences = workspace.sources.map((source, index) =>
    sourceSentence(source, names[index]),
  );
  let description = `Where the subagent works. ${sentences.join(" ")}`;
  if (!workspace.required) {
    description += " Omit to run without a workspace.";
  }
  const workspaceField = z
    .enum(names as [string, ...string[]])
    .describe(description);

  return workspace.required
    ? z.object({ prompt: promptField, workspace: workspaceField })
    : z.object({
        prompt: promptField,
        workspace: workspaceField.optional(),
      });
};

const sourcesByNameOf = (
  configName: string,
  workspace: SubagentWorkspace | undefined,
  parentName: string | undefined,
): ReadonlyMap<string, SubagentWorkspaceSource> | undefined => {
  if (!workspace || workspace.pick !== "caller") return undefined;
  const names = namesOf(configName, workspace.sources, parentName);
  return new Map(
    workspace.sources.map((source, index) => [names[index], source]),
  );
};

const resolveSource = (
  workspace: SubagentWorkspace | undefined,
  sourcesByName:
    ReadonlyMap<string, SubagentWorkspaceSource> | undefined,
  requested: string | undefined,
): SubagentWorkspaceSource | undefined => {
  if (!workspace) return undefined;
  if (workspace.pick === "fixed") return workspace.source;
  if (requested === undefined) return undefined;
  const source = sourcesByName?.get(requested);
  if (!source) {
    throw new RangeError(`unknown workspace source: ${requested}`);
  }
  return source;
};

export const createSubagent = (
  config: SubagentConfig,
  environment: {
    parent?: OpenWorkspace;
    exclusive: ExclusiveNames;
    parentExclusiveNames: readonly string[];
  },
): Subagent => {
  const {
    parent,
    exclusive: exclusiveNames,
    parentExclusiveNames: parentHeldNames,
  } = environment;
  const tools = config.tools ?? [];
  const parentName = parent?.name;
  validateWorkspace(config.name, config.workspace, parentName);
  validateHeldNames(config.name, config.workspace, parentHeldNames);
  createHarness(config.harness, config.provider, config.gate, tools);

  const inputSchema = buildInputSchema(
    config.name,
    config.workspace,
    parentName,
  );
  const sourcesByName = sourcesByNameOf(
    config.name,
    config.workspace,
    parentName,
  );

  const subagent: Subagent = {
    name: config.name,
    description: config.description,
    input: inputSchema,
    async start(
      input: { prompt: string; workspace?: string },
      context: SubagentContext,
    ): Promise<string> {
      const trace = context.trace ?? noopSpan;
      const messages: Message[] = config.system
        ? [
            { role: "system", content: config.system },
            { role: "user", content: input.prompt },
          ]
        : [{ role: "user", content: input.prompt }];

      const runWith = async (
        merged: readonly Tool[],
      ): Promise<string> => {
        const harness = createHarness(
          config.harness,
          config.provider,
          config.gate,
          merged,
        );
        const result = await collect(
          harness({ messages, signal: context.signal, trace }),
        );
        return finalTextOf(result, config.harness.maxTurns);
      };

      const source = resolveSource(
        config.workspace,
        sourcesByName,
        input.workspace,
      );

      if (!source) {
        return runWith(tools);
      }

      if (source.kind === "parent") {
        return runWith(mergeWorkspaceTools(tools, parent));
      }

      const release = await exclusiveNames.acquire(
        exclusiveNamesOf(source.workspace),
        context.signal,
      );
      let succeeded = false;
      let answer = "";
      try {
        return await withWorkspace(
          source.workspace,
          { trace, signal: context.signal },
          async (opened) => {
            const result = await runWith(
              mergeWorkspaceTools(tools, opened),
            );
            succeeded = true;
            answer = result;
            return result;
          },
        );
      } catch (error) {
        if (succeeded) {
          throw new SubagentCloseError(source.workspace.name, answer, {
            cause: error,
          });
        }
        throw error;
      } finally {
        release();
      }
    },
  };
  return subagent;
};
