import type { SessionSummary } from "@mg/trace/store";
import { Heading, Layout } from "@mg/ui";
import type { Scheme } from "@mg/ui";
import { SessionList } from "../../feature/SessionList/index.js";

export const SessionsPage = ({
  sessions,
  scheme,
  css,
}: {
  sessions: SessionSummary[];
  scheme: Scheme;
  css: string;
}) => (
  <Layout
    title="Sessions"
    scheme={scheme}
    css={css}
    schemeAction="/theme"
  >
    <Heading>Sessions</Heading>
    <SessionList sessions={sessions} />
  </Layout>
);
