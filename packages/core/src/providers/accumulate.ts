import type {
  AssistantPart,
  ReasoningCarry,
  StreamEvent,
} from "./types.js";

type OpenRun =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string; carry?: ReasoningCarry };

const isKeepable = (run: OpenRun): boolean =>
  run.type === "reasoning"
    ? run.text !== "" || run.carry !== undefined
    : run.text !== "";

const toPart = (run: OpenRun): AssistantPart =>
  run.type === "text"
    ? { type: "text", text: run.text }
    : run.carry === undefined
      ? { type: "reasoning", text: run.text }
      : { type: "reasoning", text: run.text, carry: run.carry };

export const createPartsAccumulator = (): {
  push(event: StreamEvent): void;
  parts(): AssistantPart[];
} => {
  const closed: AssistantPart[] = [];
  let open: OpenRun | undefined;

  const closeOpen = (): void => {
    if (open && isKeepable(open)) {
      closed.push(toPart(open));
    }
    open = undefined;
  };

  return {
    push(event: StreamEvent): void {
      switch (event.type) {
        case "text-delta": {
          if (open?.type === "text") {
            open.text += event.delta;
          } else {
            closeOpen();
            open = { type: "text", text: event.delta };
          }
          break;
        }
        case "reasoning-delta": {
          if (open?.type === "reasoning") {
            open.text += event.delta;
            if (event.carry !== undefined) {
              open.carry = event.carry;
            }
          } else {
            closeOpen();
            open = {
              type: "reasoning",
              text: event.delta,
              carry: event.carry,
            };
          }
          break;
        }
        case "tool-call": {
          closeOpen();
          closed.push({ type: "tool-call", ...event.toolCall });
          break;
        }
        case "finish":
          break;
      }
    },
    parts(): AssistantPart[] {
      const result = [...closed];
      if (open && isKeepable(open)) {
        result.push(toPart(open));
      }
      return result;
    },
  };
};
