import { z, type OpenAPIHono } from "@hono/zod-openapi";
import type { DefinitionStore } from "../definition-store/index.js";
import type { TrialEvent, Trials } from "../trial/index.js";

// `system` is the prompt as the page has it now, saved or not.
const message = z.object({
  input: z.string().min(1),
  system: z.string(),
  conversationId: z.string().optional(),
});

// One JSON value on each line, sent as it comes. `stop` is called when
// the reader goes away.
const lines = (
  events: AsyncIterable<TrialEvent>,
  stop: () => void,
): ReadableStream<Uint8Array> => {
  const encoder = new TextEncoder();
  const iterator = events[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    pull: async (controller) => {
      const next = await iterator.next();
      if (next.done === true) {
        controller.close();
        return;
      }
      controller.enqueue(
        encoder.encode(`${JSON.stringify(next.value)}\n`),
      );
    },
    cancel: () => {
      stop();
      void iterator.return?.();
    },
  });
};

// The answer is one response that stays open, so it is not one of the
// described routes the client is generated from. Closing the response
// from the page stops the agent.
export const registerTrialApi = (
  api: OpenAPIHono,
  store: DefinitionStore,
  trials: Trials,
): void => {
  api.post("/harnesses/:id/trial", async (c) => {
    const saved = await store.get(c.req.param("id"));
    if (saved === undefined) return c.notFound();

    const sent = message.safeParse(
      await c.req.json().catch(() => undefined),
    );
    if (!sent.success) return c.text("Bad Request", 400);

    const { system: _saved, ...rest } = saved;
    const { input, system, conversationId } = sent.data;
    const stop = new AbortController();
    c.req.raw.signal.addEventListener("abort", () => stop.abort());

    const events = trials.send(
      system === "" ? rest : { ...rest, system },
      input,
      { conversationId, signal: stop.signal },
    );
    return c.body(
      lines(events, () => stop.abort()),
      200,
      {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
      },
    );
  });
};
