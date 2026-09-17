import {
  ProviderHttpError,
  ToolArgumentsError,
  ToolSchemaError,
} from "../errors.js";
import { textOf, toolCallsOf } from "../parts.js";
import type {
  AssistantPart,
  FinishReason,
  GenerateRequest,
  GenerateResponse,
  Message,
  ToolCall,
  ToolChoice,
  ToolDefinition,
  Usage,
} from "../types.js";

type OpenRouterToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type OpenRouterMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string;
      tool_calls?: OpenRouterToolCall[];
    }
  | { role: "tool"; tool_call_id: string; content: string };

type OpenRouterTool = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
};

type OpenRouterToolChoice =
  | "auto"
  | "none"
  | "required"
  | { type: "function"; function: { name: string } };

type OpenRouterResponseToolCall = {
  id: string;
  type?: string;
  function?: { name?: string; arguments?: unknown };
};

type OpenRouterResponseBody = {
  choices?: {
    message?: {
      content?: string | null;
      tool_calls?: OpenRouterResponseToolCall[] | null;
    } | null;
    finish_reason?: string | null;
  }[];
  usage?: { prompt_tokens: number; completion_tokens: number } | null;
};

const toMessage = (message: Message): OpenRouterMessage => {
  switch (message.role) {
    case "system":
      return { role: "system", content: message.content };
    case "user":
      return { role: "user", content: message.content };
    case "assistant": {
      const content = textOf(message);
      const toolCalls = toolCallsOf(message);
      if (toolCalls.length === 0) {
        return { role: "assistant", content };
      }
      return {
        role: "assistant",
        content,
        tool_calls: toolCalls.map((toolCall) => ({
          id: toolCall.id,
          type: "function",
          function: {
            name: toolCall.name,
            arguments: JSON.stringify(toolCall.arguments),
          },
        })),
      };
    }
    case "tool":
      return {
        role: "tool",
        tool_call_id: message.toolCallId,
        content: message.content,
      };
  }
};

const toTool = (tool: ToolDefinition): OpenRouterTool => {
  let parameters: Record<string, unknown>;
  try {
    parameters = tool.input["~standard"].jsonSchema.input({
      target: "draft-07",
    });
  } catch (cause) {
    throw new ToolSchemaError(tool.name, { cause });
  }

  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters,
    },
  };
};

const toToolChoice = (toolChoice: ToolChoice): OpenRouterToolChoice =>
  typeof toolChoice === "string"
    ? toolChoice
    : { type: "function", function: { name: toolChoice.name } };

export const toOpenRouterRequest = (
  request: GenerateRequest,
  stream: boolean,
): object => {
  const body: Record<string, unknown> = {
    model: request.model,
    messages: request.messages.map(toMessage),
    stream,
  };

  if (stream) {
    body.stream_options = { include_usage: true };
  }
  if (request.tools !== undefined && request.tools.length > 0) {
    body.tools = request.tools.map(toTool);
  }
  if (request.toolChoice !== undefined) {
    body.tool_choice = toToolChoice(request.toolChoice);
  }
  if (request.temperature !== undefined) {
    body.temperature = request.temperature;
  }
  if (request.maxTokens !== undefined) {
    body.max_tokens = request.maxTokens;
  }

  return body;
};

export const toFinishReason = (
  finishReason: string | null | undefined,
): FinishReason => {
  switch (finishReason) {
    case "stop":
      return "stop";
    case "tool_calls":
      return "tool_calls";
    case "length":
      return "length";
    default:
      return "other";
  }
};

export const toUsage = (usage: {
  prompt_tokens: number;
  completion_tokens: number;
}): Usage => ({
  inputTokens: usage.prompt_tokens,
  outputTokens: usage.completion_tokens,
});

export const toToolCall = (
  toolCall: OpenRouterResponseToolCall,
): ToolCall => {
  const name = toolCall.function?.name ?? "";
  const raw = toolCall.function?.arguments;

  if (typeof raw !== "string") {
    throw new ToolArgumentsError(toolCall.id, name, String(raw));
  }

  if (raw.trim() === "") {
    return { id: toolCall.id, name, arguments: {} };
  }

  try {
    return { id: toolCall.id, name, arguments: JSON.parse(raw) };
  } catch (cause) {
    throw new ToolArgumentsError(toolCall.id, name, raw, { cause });
  }
};

export const fromOpenRouterResponse = (
  body: unknown,
): GenerateResponse => {
  if (typeof body !== "object" || body === null) {
    throw new ProviderHttpError(
      "OpenRouter response has no choices",
      200,
      JSON.stringify(body),
    );
  }

  const parsed = body as OpenRouterResponseBody;
  const choice = parsed.choices?.[0];
  const message = choice?.message;

  if (message === undefined || message === null) {
    throw new ProviderHttpError(
      "OpenRouter response has no choices",
      200,
      JSON.stringify(body),
    );
  }

  const parts: AssistantPart[] = [];
  const content = message.content ?? "";
  if (content !== "") {
    parts.push({ type: "text", text: content });
  }
  for (const toolCall of (message.tool_calls ?? []).map(toToolCall)) {
    parts.push({ type: "tool-call", ...toolCall });
  }

  const response: GenerateResponse = {
    parts,
    finishReason: toFinishReason(choice?.finish_reason),
  };

  const usage = parsed.usage;
  if (usage !== undefined && usage !== null) {
    return { ...response, usage: toUsage(usage) };
  }

  return response;
};
