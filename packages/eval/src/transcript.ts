import type { AssistantPart, Message } from "@mg/core";
import type { GateStep, RunView } from "./view.js";

export type TranscribeOptions = { maxToolResultLength?: number };

const truncate = (
  text: string,
  maxLength: number | undefined,
): string =>
  maxLength === undefined || text.length <= maxLength
    ? text
    : `${text.slice(0, maxLength)}…`;

const transcribeAssistantParts = (
  parts: readonly AssistantPart[],
): string[] =>
  parts.flatMap((part): string[] => {
    if (part.type === "text") {
      return part.text === "" ? [] : [`[assistant] ${part.text}`];
    }
    if (part.type === "tool-call") {
      return [
        `[assistant tool-call ${part.name}] ${JSON.stringify(
          part.arguments,
        )}`,
      ];
    }
    return [];
  });

const transcribeMessage = (message: Message): string[] => {
  switch (message.role) {
    case "system":
      return [`[system] ${message.content}`];
    case "user":
      return [`[user] ${message.content}`];
    case "tool":
      return [`[tool ${message.toolCallId}] ${message.content}`];
    case "assistant":
      return transcribeAssistantParts(message.parts);
    default:
      return [];
  }
};

const transcribeGateStep = (step: GateStep): string => {
  const verdict =
    step.error !== undefined
      ? "error"
      : step.allowed === true
        ? "allowed"
        : "denied";
  const body = step.reason ?? step.error ?? "";
  return `[gate ${step.kind} ${verdict}] ${body}`;
};

export const transcribe = (
  view: RunView,
  options?: TranscribeOptions,
): string => {
  const blocks: string[] = [];

  const firstLlmStep = view.llmSteps[0];
  if (firstLlmStep !== undefined) {
    for (const message of firstLlmStep.input) {
      blocks.push(...transcribeMessage(message));
    }
  }

  for (const step of view.steps) {
    if (step.type === "llm") {
      for (const message of step.output) {
        blocks.push(...transcribeAssistantParts(message.parts));
      }
    } else if (step.type === "tool") {
      if (step.error !== undefined) {
        blocks.push(`[tool ${step.name} error] ${step.error}`);
      } else {
        const result = truncate(
          step.result ?? "",
          options?.maxToolResultLength,
        );
        blocks.push(`[tool ${step.name}] ${result}`);
      }
    } else {
      blocks.push(transcribeGateStep(step));
    }
  }

  return blocks.join("\n\n");
};
