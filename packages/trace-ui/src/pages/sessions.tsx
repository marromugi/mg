import type { SessionSummary } from "@mg/trace/store";
import { Layout } from "./layout.js";

export const SessionsPage = ({ sessions }: { sessions: SessionSummary[] }) => (
  <Layout title="Sessions">
    <h1>Sessions</h1>
    <table>
      <thead>
        <tr>
          <th>Session</th>
          <th>Start</th>
          <th>End</th>
          <th>Traces</th>
        </tr>
      </thead>
      <tbody>
        {sessions.map((session) => (
          <tr key={session.sessionId}>
            <td>
              <a href={`/sessions/${encodeURIComponent(session.sessionId)}`}>{session.sessionId}</a>
            </td>
            <td>{session.startTime}</td>
            <td>{session.endTime}</td>
            <td>{session.traceCount}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </Layout>
);
