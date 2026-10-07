export const TOOL_NAMES = [
  "bash",
  "read_file",
  "grep",
  "write_file",
  "edit_file",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export type PathRule = {
  tools?: readonly ToolName[];
  paths?: readonly string[];
  allowed: boolean;
  reason?: string;
};

export type HarnessDefinition = {
  id: string;
  name: string;
  // What the agent's face is drawn from.
  avatar?: string;
  provider:
    { kind: "openrouter" } | { kind: "ollama"; baseUrl?: string };
  harness: { kind: "loop"; model: string; maxTurns: number };
  means?: {
    root: string;
    tools: readonly [ToolName, ...ToolName[]];
    rules: readonly PathRule[];
    judge?: { model: string; instruction: string };
    // Jev answers the question for each action; yes lets it through.
    gate?: { question: string };
  };
};
