import {
  ProviderHttpError,
  ProviderUnsupportedError,
  ToolArgumentsError,
  ToolSchemaError,
} from "../errors.js";
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

export type OllamaRequestOptions = {
  think?: boolean;
  keepAlive?: string | number;
  numCtx?: number;
};

type OllamaToolCall = {
  id: string;
  function: { name: string; arguments: unknown };
};

type OllamaMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string;
      tool_calls?: OllamaToolCall[];
    }
  | { role: "tool"; tool_name: string; content: string };

type OllamaTool = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
};

type OllamaResponseToolCall = {
  id?: string;
  function?: { index?: number; name?: string; arguments?: unknown };
};

type OllamaResponseBody = {
  message?: {
    content?: string;
    thinking?: string;
    tool_calls?: OllamaResponseToolCall[] | null;
  } | null;
  done?: boolean;
  done_reason?: string | null;
  prompt_eval_count?: number;
  eval_count?: number;
};

const toMessages = (messages: Message[]): OllamaMessage[] => {
  const toolNames = new Map<string, string>();

  return messages.map((message) => {
    switch (message.role) {
      case "system":
        return { role: "system", content: message.content };
      case "user":
        return { role: "user", content: message.content };
      case "assistant": {
        const toolCalls = message.toolCalls;
        if (toolCalls !== undefined) {
          for (const toolCall of toolCalls) {
            toolNames.set(toolCall.id, toolCall.name);
          }
        }
        if (toolCalls === undefined || toolCalls.length === 0) {
          return { role: "assistant", content: message.content };
        }
        return {
          role: "assistant",
          content: message.content,
          tool_calls: toolCalls.map((toolCall) => ({
            id: toolCall.id,
            function: {
              name: toolCall.name,
              arguments: toolCall.arguments,
            },
          })),
        };
      }
      case "tool": {
        const toolName = toolNames.get(message.toolCallId);
        if (toolName === undefined) {
          throw new ProviderUnsupportedError(
            `Ollama could not find the tool call ${message.toolCallId} for this tool message`,
            "tool-message-without-call",
          );
        }
        return {
          role: "tool",
          tool_name: toolName,
          content: message.content,
        };
      }
    }
  });
};

const toTool = (tool: ToolDefinition): OllamaTool => {
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

const assertSupportedToolChoice = (toolChoice: ToolChoice): void => {
  if (toolChoice === "required" || typeof toolChoice === "object") {
    throw new ProviderUnsupportedError(
      "Ollama does not support forcing tool use",
      "tool-choice",
    );
  }
};

export const toOllamaRequest = (
  request: GenerateRequest,
  stream: boolean,
  options?: OllamaRequestOptions,
): object => {
  const toolChoice = request.toolChoice;
  if (toolChoice !== undefined) {
    assertSupportedToolChoice(toolChoice);
  }

  const body: Record<string, unknown> = {
    model: request.model,
    messages: toMessages(request.messages),
    stream,
  };

  if (
    toolChoice !== "none" &&
    request.tools !== undefined &&
    request.tools.length > 0
  ) {
    body.tools = request.tools.map(toTool);
  }

  if (options?.think !== undefined) {
    body.think = options.think;
  }
  if (options?.keepAlive !== undefined) {
    body.keep_alive = options.keepAlive;
  }

  const innerOptions: Record<string, unknown> = {};
  if (request.temperature !== undefined) {
    innerOptions.temperature = request.temperature;
  }
  if (request.maxTokens !== undefined) {
    innerOptions.num_predict = request.maxTokens;
  }
  if (options?.numCtx !== undefined) {
    innerOptions.num_ctx = options.numCtx;
  }
  if (Object.keys(innerOptions).length > 0) {
    body.options = innerOptions;
  }

  return body;
};

export const toFinishReason = (
  doneReason: string | null | undefined,
  hasToolCalls: boolean,
): FinishReason => {
  if (hasToolCalls) {
    return "tool_calls";
  }

  switch (doneReason) {
    case "stop":
      return "stop";
    case "length":
      return "length";
    default:
      return "other";
  }
};

export const toUsage = (body: {
  prompt_eval_count?: number;
  eval_count?: number;
}): Usage | undefined => {
  const { prompt_eval_count: inputTokens, eval_count: outputTokens } =
    body;

  if (
    typeof inputTokens !== "number" ||
    typeof outputTokens !== "number"
  ) {
    return undefined;
  }

  return { inputTokens, outputTokens };
};

export const toToolCall = (
  raw: OllamaResponseToolCall,
  fallbackIndex: number,
): ToolCall => {
  const id = raw.id ?? `call_${fallbackIndex}`;
  const name = raw.function?.name ?? "";
  const args = raw.function?.arguments;

  if (typeof args !== "object" || args === null) {
    throw new ToolArgumentsError(id, name, String(args));
  }

  return { id, name, arguments: args };
};

export const fromOllamaResponse = (body: unknown): GenerateResponse => {
  if (typeof body !== "object" || body === null) {
    throw new ProviderHttpError(
      "Ollama response has no message",
      200,
      JSON.stringify(body),
    );
  }

  const parsed = body as OllamaResponseBody;
  const message = parsed.message;

  if (message === undefined || message === null) {
    throw new ProviderHttpError(
      "Ollama response has no message",
      200,
      JSON.stringify(body),
    );
  }

  const toolCalls = (message.tool_calls ?? []).map((toolCall, index) =>
    toToolCall(toolCall, index),
  );

  const response: GenerateResponse = {
    content: message.content ?? "",
    toolCalls,
    finishReason: toFinishReason(
      parsed.done_reason,
      toolCalls.length > 0,
    ),
  };

  const usage = toUsage(parsed);
  if (usage !== undefined) {
    return { ...response, usage };
  }

  return response;
};
