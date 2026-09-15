import type { SessionSummary } from "@mg/trace/store";

const CELL = "border-b border-edge px-2.5 py-1.5 text-left";

export const SessionList = ({
  sessions,
}: {
  sessions: SessionSummary[];
}) => (
  <table className="w-full">
    <thead>
      <tr>
        <th className={CELL}>Session</th>
        <th className={CELL}>Start</th>
        <th className={CELL}>End</th>
        <th className={CELL}>Traces</th>
      </tr>
    </thead>
    <tbody>
      {sessions.map((session) => (
        <tr key={session.sessionId}>
          <td className={CELL}>
            <a
              href={`/sessions/${encodeURIComponent(session.sessionId)}`}
              className="underline"
            >
              {session.sessionId}
            </a>
          </td>
          <td className={CELL}>{session.startTime}</td>
          <td className={CELL}>{session.endTime}</td>
          <td className={CELL}>{session.traceCount}</td>
        </tr>
      ))}
    </tbody>
  </table>
);
