import type { SessionSummary } from "@mg/trace/store";
import { SessionList } from "../../feature/SessionList/index.js";
import { Heading, Layout } from "../../ui/index.js";

export const SessionsPage = ({
  sessions,
}: {
  sessions: SessionSummary[];
}) => (
  <Layout title="Sessions">
    <Heading>Sessions</Heading>
    <SessionList sessions={sessions} />
  </Layout>
);
