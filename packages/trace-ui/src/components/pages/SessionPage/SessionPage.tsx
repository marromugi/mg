import type { SessionTree } from "@mg/trace/store";
import { Heading, Layout, Meta } from "@mg/ui";
import type { Scheme } from "@mg/ui";
import { SpanTree } from "../../feature/SpanTree/index.js";

export const SessionPage = ({
  session,
  scheme,
  css,
}: {
  session: SessionTree;
  scheme: Scheme;
  css: string;
}) => (
  <Layout
    title={`Session ${session.sessionId}`}
    scheme={scheme}
    css={css}
    schemeAction="/theme"
  >
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
