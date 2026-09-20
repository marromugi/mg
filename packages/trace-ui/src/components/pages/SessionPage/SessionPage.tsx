import type { SessionTree } from "@mg/trace/store";
import { Heading, Meta } from "@mg/ui";
import type { Scheme } from "../../../scheme.js";
import { SpanTree } from "../../feature/SpanTree/index.js";
import { Layout } from "../../ui/index.js";

export const SessionPage = ({
  session,
  scheme,
}: {
  session: SessionTree;
  scheme: Scheme;
}) => (
  <Layout title={`Session ${session.sessionId}`} scheme={scheme}>
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
