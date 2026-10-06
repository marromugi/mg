import type { TestRunEvent } from "../../../test-run/index.js";
import { Notice } from "../../ui/index.js";
import { useRunEvent } from "./hooks/useRunEvent.js";

const TracePath = ({ path }: { path: string }) => (
  <p className="text-meta">
    {"トレース: "}
    <code className="font-mono">{path}</code>
  </p>
);

// One event of a run as a piece that can be sent on its own. Text is
// inline so that consecutive pieces read as one paragraph; the rest are
// blocks.
export const RunEvent = ({ event }: { event: TestRunEvent }) => {
  const view = useRunEvent(event);

  switch (view.kind) {
    case "none":
      return null;
    case "text":
      return <span className="whitespace-pre-wrap">{view.text}</span>;
    case "tool-call":
      return (
        <div className="my-3 rounded-container border border-edge container-p-3">
          <p className="text-meta font-semibold">
            {`ツール呼び出し: ${view.name}`}
          </p>
          <pre className="font-mono text-meta whitespace-pre-wrap">
            {view.input}
          </pre>
        </div>
      );
    case "tool-result":
      return (
        <div className="my-3 rounded-container border border-edge container-p-3">
          <p className="text-meta font-semibold">ツールの結果</p>
          <pre className="font-mono text-meta whitespace-pre-wrap">
            {view.content}
          </pre>
        </div>
      );
    case "ended":
      return (
        <section data-ended="" className="mt-6 flex flex-col gap-1">
          <h2 className="font-semibold">実行が終わりました</h2>
          <p>{`終了理由: ${view.reason}`}</p>
          <p>{`入力トークン: ${view.inputTokens}`}</p>
          <p>{`出力トークン: ${view.outputTokens}`}</p>
          <TracePath path={view.tracePath} />
        </section>
      );
    case "stopped":
      return (
        <section data-ended="" className="mt-6 flex flex-col gap-1">
          <h2 className="font-semibold">実行を止めました</h2>
          <TracePath path={view.tracePath} />
        </section>
      );
    case "failed":
      return (
        <section data-ended="" className="mt-6 flex flex-col gap-2">
          <Notice>{`実行に失敗しました。${view.message}`}</Notice>
          <TracePath path={view.tracePath} />
        </section>
      );
  }
};
