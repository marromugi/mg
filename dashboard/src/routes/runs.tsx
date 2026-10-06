import { join } from "node:path";
import type { Hono } from "hono";
import { RunEvent } from "../components/feature/RunEvent/index.js";
import { RunMissingPage } from "../components/pages/RunMissingPage/index.js";
import { RunNotStoppedPage } from "../components/pages/RunNotStoppedPage/index.js";
import { RunPage } from "../components/pages/RunPage/index.js";
import {
  renderPage,
  renderPageAround,
  renderPiece,
} from "../render.js";
import {
  TRACE_DIR_NAME,
  type TestRunEvent,
  type TestRuns,
} from "../test-run/index.js";

const TITLE = "テスト実行";

async function* pieces(
  events: AsyncIterable<TestRunEvent>,
): AsyncGenerator<string> {
  for await (const event of events) {
    const piece = renderPiece(<RunEvent event={event} />);
    if (piece !== "") yield piece;
  }
}

// One response that stays open: the first half of the page, each piece
// as it arrives, then the second half.
const streamed = (
  head: string,
  middle: AsyncIterable<string>,
  tail: string,
): ReadableStream<Uint8Array> => {
  const encoder = new TextEncoder();
  const iterator = middle[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    start: (controller) => {
      controller.enqueue(encoder.encode(head));
    },
    pull: async (controller) => {
      const next = await iterator.next();
      if (next.done === true) {
        controller.enqueue(encoder.encode(tail));
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(next.value));
    },
    cancel: () => {
      void iterator.return?.();
    },
  });
};

export const registerRuns = (
  app: Hono,
  runs: TestRuns,
  dataDir: string,
): void => {
  app.get("/runs/:runId", (c) => {
    const runId = c.req.param("runId");
    const events = runs.watch(runId);
    if (events === undefined) {
      return c.html(
        renderPage(
          TITLE,
          <RunMissingPage traceDir={join(dataDir, TRACE_DIR_NAME)} />,
        ),
        404,
      );
    }
    const { head, tail } = renderPageAround(TITLE, (slot) => (
      <RunPage stopAction={`/runs/${runId}/stop`} events={slot} />
    ));
    return c.body(streamed(head, pieces(events), tail), 200, {
      "Content-Type": "text/html; charset=UTF-8",
      "Cache-Control": "no-store",
    });
  });

  app.post("/runs/:runId/stop", (c) => {
    const runId = c.req.param("runId");
    if (!runs.stop(runId)) {
      return c.html(
        renderPage(
          TITLE,
          <RunNotStoppedPage runHref={`/runs/${runId}`} />,
        ),
        409,
      );
    }
    return c.redirect(`/runs/${runId}`, 303);
  });
};
