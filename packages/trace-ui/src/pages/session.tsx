import type { SessionTree } from "@mg/trace/store";
import { Layout } from "./layout.js";
import { SpanNodeView } from "./span-node.js";

export const SessionPage = ({ session }: { session: SessionTree }) => (
  <Layout title={`Session ${session.sessionId}`}>
    <p>
      <a href="/">← Sessions</a>
    </p>
    <h1>{session.sessionId}</h1>
    <p className="span-time">
      {session.startTime} – {session.endTime}
    </p>
    {session.traces.map((trace) => (
      <section key={trace.root.spanId}>
        <SpanNodeView node={trace.root} />
      </section>
    ))}
  </Layout>
);
