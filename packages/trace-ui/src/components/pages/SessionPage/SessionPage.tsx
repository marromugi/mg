import type { SessionTree } from "@mg/trace/store";
import { SpanTree } from "../../feature/SpanTree/index.js";
import { Heading, Layout, Meta } from "../../ui/index.js";

export const SessionPage = ({ session }: { session: SessionTree }) => (
  <Layout title={`Session ${session.sessionId}`}>
    <p className="my-4">
      <a href="/" className="underline">
        ← Sessions
      </a>
    </p>
    <Heading>{session.sessionId}</Heading>
    <Meta>
      {session.startTime} – {session.endTime}
    </Meta>
    {session.traces.map((trace) => (
      <section key={trace.root.spanId}>
        <SpanTree node={trace.root} />
      </section>
    ))}
  </Layout>
);
