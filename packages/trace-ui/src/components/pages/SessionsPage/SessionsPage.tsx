import type { SessionSummary } from "@mg/trace/store";
import { Heading } from "@mg/ui";
import type { Scheme } from "../../../scheme.js";
import { SessionList } from "../../feature/SessionList/index.js";
import { Layout } from "../../ui/index.js";

export const SessionsPage = ({
  sessions,
  scheme,
}: {
  sessions: SessionSummary[];
  scheme: Scheme;
}) => (
  <Layout title="Sessions" scheme={scheme}>
    <Heading>Sessions</Heading>
    <SessionList sessions={sessions} />
  </Layout>
);
