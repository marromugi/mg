import type { SessionTree } from "@mg/trace/store";
import { SpanTree } from "../../feature/SpanTree/index.js";
import { Layout } from "../../ui/index.js";

export const SessionPage = ({ session }: { session: SessionTree }) => (
  <Layout title={`Session ${session.sessionId}`}>
    <p className="my-4">
      <a href="/" className="underline">
        ← Sessions
      </a>
    </p>
    <h1 className="my-4 text-heading font-bold">{session.sessionId}</h1>
    <p className="text-meta font-normal opacity-70">
      {session.startTime} – {session.endTime}
    </p>
    {session.traces.map((trace) => (
      <section key={trace.root.spanId}>
        <SpanTree node={trace.root} />
      </section>
    ))}
  </Layout>
);
