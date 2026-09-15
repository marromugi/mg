import type { SessionSummary } from "@mg/trace/store";

export const SessionList = ({
  sessions,
}: {
  sessions: SessionSummary[];
}) => (
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
            <a
              href={`/sessions/${encodeURIComponent(session.sessionId)}`}
            >
              {session.sessionId}
            </a>
          </td>
          <td>{session.startTime}</td>
          <td>{session.endTime}</td>
          <td>{session.traceCount}</td>
        </tr>
      ))}
    </tbody>
  </table>
);
