import { useRef, useState } from "react";
import type { TrialEvent } from "../../../../trial/events.js";
import type { ChatItem, Trial } from "../transcript.js";
import { withEvent, withSent, withStopped } from "./useTranscript.js";

const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

// The events of an answer, read from a body that carries one JSON value
// on each line.
async function* eventsOf(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<TrialEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let rest = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    const lines = (
      rest + decoder.decode(value, { stream: true })
    ).split("\n");
    rest = lines.pop() ?? "";
    for (const line of lines) {
      if (line !== "") yield JSON.parse(line) as TrialEvent;
    }
  }
}

// A trial conversation with one agent, held by the server through the
// API. A message sent after the prompt changed starts a new
// conversation, because the old one was held under the old prompt.
export const useTrial = (harnessId: string): Trial => {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [state, setState] = useState<Trial["state"]>("idle");
  const conversation = useRef<{ id: string; system: string }>(
    undefined,
  );
  const answer = useRef<AbortController>(undefined);

  const send = async (input: string, system: string) => {
    if (answer.current !== undefined) return;
    const held = conversation.current;
    const continued = held?.system === system ? held : undefined;
    conversation.current = continued;
    const stop = new AbortController();
    answer.current = stop;
    setItems((before) =>
      withSent(
        before,
        input,
        held !== undefined && continued === undefined,
      ),
    );
    setState("answering");

    try {
      const response = await fetch(
        `/api/harnesses/${harnessId}/trial`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            input,
            system,
            conversationId: continued?.id,
          }),
          signal: stop.signal,
        },
      );
      if (!response.ok || response.body === null) {
        throw new Error(`サーバーが ${response.status} を返しました`);
      }
      for await (const event of eventsOf(response.body)) {
        if (event.type === "started") {
          conversation.current = { id: event.conversationId, system };
        }
        setItems((before) => withEvent(before, event));
      }
    } catch (error) {
      if (!stop.signal.aborted) {
        setItems((before) =>
          withEvent(before, {
            type: "failed",
            message: reasonOf(error),
          }),
        );
      }
    } finally {
      if (answer.current === stop) {
        answer.current = undefined;
        setState("idle");
      }
    }
  };

  return {
    items,
    state,
    send: (input, system) => void send(input, system),
    stop: () => {
      if (answer.current === undefined) return;
      answer.current.abort();
      answer.current = undefined;
      setItems(withStopped);
      setState("idle");
    },
    reset: () => {
      answer.current?.abort();
      answer.current = undefined;
      conversation.current = undefined;
      setItems([]);
      setState("idle");
    },
  };
};
