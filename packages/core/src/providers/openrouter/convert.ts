import {
  ProviderHttpError,
  ProviderUnsupportedError,
  ToolArgumentsError,
  ToolSchemaError,
} from "../errors.js";
import { partsOf, reasoningOf, textOf, toolCallsOf } from "../parts.js";
import type {
  AssistantMessage,
  AssistantPart,
  FinishReason,
  GenerateRequest,
  GenerateResponse,
  Message,
  Omission,
  ToolCall,
  ToolCallCarry,
  ToolCallPart,
  ToolChoice,
  ToolDefinition,
  Usage,
} from "../types.js";
import { PROVIDER_NAME } from "./name.js";

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
      reasoning?: string;
      reasoning_details?: unknown[];
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
  id?: string | null;
  type?: string;
  function?: { name?: string; arguments?: unknown };
};

type OpenRouterResponseBody = {
  choices?: {
    message?: {
      content?: string | null;
      reasoning?: string | null;
      reasoning_details?: unknown[] | null;
      tool_calls?: OpenRouterResponseToolCall[] | null;
    } | null;
    finish_reason?: string | null;
  }[];
  usage?: { prompt_tokens: number; completion_tokens: number } | null;
};

const openRouterReasoningFields = (
  message: AssistantMessage,
): { reasoning?: string; reasoning_details?: unknown[] } => {
  const details = partsOf(message).flatMap((part) =>
    part.type === "reasoning" &&
    part.carry?.provider === PROVIDER_NAME &&
    Array.isArray(part.carry.data)
      ? part.carry.data
      : [],
  );

  if (details.length > 0) {
    return { reasoning_details: details };
  }

  const text = reasoningOf(message);
  return text === "" ? {} : { reasoning: text };
};

const vendorIdOf = (part: ToolCallPart): string | undefined => {
  const { carry } = part;
  if (carry?.provider !== PROVIDER_NAME) {
    return undefined;
  }
  const data = carry.data;
  if (typeof data !== "object" || data === null) {
    return undefined;
  }
  const id = (data as { id?: unknown }).id;
  return typeof id === "string" && id !== "" ? id : undefined;
};

type ToolCallIds = {
  // a call's own id -> the id sent for it and for its result
  sent: Map<string, string>;
  // own ids of the calls whose vendor id is shared and so not sent
  omitted: string[];
};

const resolveToolCallIds = (messages: Message[]): ToolCallIds => {
  const calls = messages.flatMap((message) =>
    message.role === "assistant"
      ? partsOf(message).filter(
          (part): part is ToolCallPart => part.type === "tool-call",
        )
      : [],
  );

  const vendorCounts = new Map<string, number>();
  for (const call of calls) {
    const vendorId = vendorIdOf(call);
    if (vendorId !== undefined) {
      vendorCounts.set(vendorId, (vendorCounts.get(vendorId) ?? 0) + 1);
    }
  }

  const sent = new Map<string, string>();
  const omitted: string[] = [];
  for (const call of calls) {
    const vendorId = vendorIdOf(call);
    if (vendorId === undefined) {
      sent.set(call.id, call.id);
    } else if (vendorCounts.get(vendorId) === 1) {
      sent.set(call.id, vendorId);
    } else {
      sent.set(call.id, call.id);
      omitted.push(call.id);
    }
  }
  return { sent, omitted };
};

const toMessage = (
  message: Message,
  sendReasoning: boolean,
  sentIds: Map<string, string>,
): OpenRouterMessage => {
  switch (message.role) {
    case "system":
      return { role: "system", content: message.content };
    case "user":
      return { role: "user", content: message.content };
    case "assistant": {
      const content = textOf(message);
      const toolCalls = toolCallsOf(message);
      const reasoning = sendReasoning
        ? openRouterReasoningFields(message)
        : {};

      if (toolCalls.length === 0) {
        return { role: "assistant", content, ...reasoning };
      }
      return {
        role: "assistant",
        content,
        tool_calls: toolCalls.map((toolCall) => ({
          id: sentIds.get(toolCall.id) ?? toolCall.id,
          type: "function",
          function: {
            name: toolCall.name,
            arguments: JSON.stringify(toolCall.arguments),
          },
        })),
        ...reasoning,
      };
    }
    case "tool": {
      const toolCallId = sentIds.get(message.toolCallId);
      if (toolCallId === undefined) {
        throw new ProviderUnsupportedError(
          `OpenRouter could not find the tool call ${message.toolCallId} for this tool message`,
          "tool-message-without-call",
        );
      }
      return {
        role: "tool",
        tool_call_id: toolCallId,
        content: message.content,
      };
    }
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

export type OpenRouterRequest = {
  body: object;
  omitted: Omission[];
};

export const toOpenRouterRequest = (
  request: GenerateRequest,
  stream: boolean,
): OpenRouterRequest => {
  const ids = resolveToolCallIds(request.messages);
  const lastUserIndex = request.messages.reduce(
    (last, message, index) => (message.role === "user" ? index : last),
    -1,
  );

  const body: Record<string, unknown> = {
    model: request.model,
    messages: request.messages.map((message, index) =>
      toMessage(message, index > lastUserIndex, ids.sent),
    ),
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

  return {
    body,
    omitted:
      ids.omitted.length === 0
        ? []
        : [{ kind: "outside-tool-call-id", toolCallIds: ids.omitted }],
  };
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
  raw: { function?: { name?: string; arguments?: unknown } },
  id: string,
): ToolCall => {
  const name = raw.function?.name ?? "";
  const args = raw.function?.arguments;

  if (typeof args !== "string") {
    throw new ToolArgumentsError(id, name, String(args));
  }

  if (args.trim() === "") {
    return { id, name, arguments: {} };
  }

  try {
    return { id, name, arguments: JSON.parse(args) };
  } catch (cause) {
    throw new ToolArgumentsError(id, name, args, { cause });
  }
};

export const toToolCallCarry = (
  vendorId: string | null | undefined,
): { carry?: ToolCallCarry } =>
  typeof vendorId !== "string" || vendorId === ""
    ? {}
    : { carry: { provider: PROVIDER_NAME, data: { id: vendorId } } };

export const fromOpenRouterResponse = (
  body: unknown,
  newToolCallId: () => string,
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
  const reasoningText = message.reasoning ?? "";
  const reasoningDetails =
    Array.isArray(message.reasoning_details) &&
    message.reasoning_details.length > 0
      ? message.reasoning_details
      : undefined;
  if (reasoningText !== "" || reasoningDetails !== undefined) {
    parts.push(
      reasoningDetails === undefined
        ? { type: "reasoning", text: reasoningText }
        : {
            type: "reasoning",
            text: reasoningText,
            carry: { provider: PROVIDER_NAME, data: reasoningDetails },
          },
    );
  }

  const content = message.content ?? "";
  if (content !== "") {
    parts.push({ type: "text", text: content });
  }
  for (const raw of message.tool_calls ?? []) {
    parts.push({
      type: "tool-call",
      ...toToolCall(raw, newToolCallId()),
      ...toToolCallCarry(raw.id),
    });
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
