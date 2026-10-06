import {
  createOllamaProvider,
  createOpenRouterProvider,
  type Provider,
  type Tool,
  type ToolForcingProvider,
} from "@mg/core";
import { composeGates, createLlmGate, createRulesGate } from "@mg/gate";
import type { RunConfig } from "@mg/runner";
import {
  createBashTool,
  createEditFileTool,
  createGrepTool,
  createReadFileTool,
  createWriteFileTool,
} from "@mg/tools";
import type {
  HarnessDefinition,
  ToolName,
} from "../definition/index.js";
import type { SecretName, SecretStore } from "../secret-store/index.js";

export type AssembleResult =
  | { ok: true; config: RunConfig }
  | { ok: false; missingSecret: SecretName };

const TOOLS: Record<ToolName, (root: string) => Tool> = {
  bash: (root) => createBashTool({ cwd: root }),
  read_file: (root) => createReadFileTool({ root }),
  grep: (root) => createGrepTool({ root }),
  write_file: (root) => createWriteFileTool({ root }),
  edit_file: (root) => createEditFileTool({ root }),
};

type Built = {
  provider: Provider;
  // Only a provider that can force a tool call can run the judge.
  judgeProvider: ToolForcingProvider | undefined;
};

const buildProvider = async (
  definition: HarnessDefinition,
  secrets: SecretStore,
): Promise<Built | { missingSecret: SecretName }> => {
  const { provider } = definition;
  if (provider.kind === "ollama") {
    return {
      provider: createOllamaProvider({ baseUrl: provider.baseUrl }),
      judgeProvider: undefined,
    };
  }
  const apiKey = await secrets.get("OPENROUTER_API_KEY");
  if (apiKey === undefined) {
    return { missingSecret: "OPENROUTER_API_KEY" };
  }
  const openRouter = createOpenRouterProvider({ apiKey });
  return { provider: openRouter, judgeProvider: openRouter };
};

// Turns a saved definition into a config `run` can take. It throws when
// the provider cannot run a part the definition names, or when a part
// refuses what it was given; the caller shows the message.
export const assemble = async (
  definition: HarnessDefinition,
  parts: { secrets: SecretStore; tracePath: string },
): Promise<AssembleResult> => {
  const built = await buildProvider(definition, parts.secrets);
  if ("missingSecret" in built) {
    return { ok: false, missingSecret: built.missingSecret };
  }

  const base = {
    name: definition.name,
    provider: built.provider,
    harness: definition.harness,
    trace: { jsonlPath: parts.tracePath },
  };
  const { means } = definition;
  if (means === undefined) return { ok: true, config: base };

  const gates = [
    createRulesGate({ root: means.root, rules: means.rules }),
  ];
  if (means.judge !== undefined) {
    if (built.judgeProvider === undefined) {
      throw new Error(
        "判定 LLM は、このプロバイダでは使えません。ツール呼び出しを強制できるプロバイダ（OpenRouter）を選んでください",
      );
    }
    gates.push(
      createLlmGate({
        provider: built.judgeProvider,
        model: means.judge.model,
        instruction: means.judge.instruction,
      }),
    );
  }

  return {
    ok: true,
    config: {
      ...base,
      tools: means.tools.map((name) => TOOLS[name](means.root)),
      gate: composeGates(gates),
    },
  };
};
