import type { SessionSummary } from "@mg/trace/store";
import { SessionList } from "../../feature/SessionList/index.js";
import { Layout } from "../../ui/index.js";

export const SessionsPage = ({
  sessions,
}: {
  sessions: SessionSummary[];
}) => (
  <Layout title="Sessions">
    <h1 className="my-4 text-heading font-bold">Sessions</h1>
    <SessionList sessions={sessions} />
  </Layout>
);
