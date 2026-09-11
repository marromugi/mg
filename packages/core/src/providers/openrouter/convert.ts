import { ToolArgumentsError } from "../errors.js";
import type {
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
  | { role: "assistant"; content: string; tool_calls?: OpenRouterToolCall[] }
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

type OpenRouterResponseBody = {
  choices?: {
    message?: {
      content?: string | null;
      tool_calls?: OpenRouterToolCall[] | null;
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
      const toolCalls = message.toolCalls;
      if (toolCalls === undefined || toolCalls.length === 0) {
        return { role: "assistant", content: message.content };
      }
      return {
        role: "assistant",
        content: message.content,
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

const toTool = (tool: ToolDefinition): OpenRouterTool => ({
  type: "function",
  function: {
    name: tool.name,
    description: tool.description,
    parameters: tool.input["~standard"].jsonSchema.input({
      target: "draft-07",
    }),
  },
});

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

  if (request.tools !== undefined) {
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

const toFinishReason = (finishReason: string | null | undefined): FinishReason => {
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

const toToolCall = (toolCall: OpenRouterToolCall): ToolCall => {
  const raw = toolCall.function.arguments;
  try {
    return {
      id: toolCall.id,
      name: toolCall.function.name,
      arguments: JSON.parse(raw),
    };
  } catch {
    throw new ToolArgumentsError(toolCall.id, toolCall.function.name, raw);
  }
};

export const fromOpenRouterResponse = (body: unknown): GenerateResponse => {
  const parsed = body as OpenRouterResponseBody;
  const choice = parsed.choices?.[0];
  const message = choice?.message;

  const response: GenerateResponse = {
    content: message?.content ?? "",
    toolCalls: (message?.tool_calls ?? []).map(toToolCall),
    finishReason: toFinishReason(choice?.finish_reason),
  };

  const usage = parsed.usage;
  if (usage !== undefined && usage !== null) {
    const mapped: Usage = {
      inputTokens: usage.prompt_tokens,
      outputTokens: usage.completion_tokens,
    };
    return { ...response, usage: mapped };
  }

  return response;
};
