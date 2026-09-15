import type { SessionSummary } from "@mg/trace/store";
import { Table } from "../../ui/index.js";

export const SessionList = ({
  sessions,
}: {
  sessions: SessionSummary[];
}) => (
  <Table>
    <Table.Head>
      <Table.Row>
        <Table.HeaderCell>Session</Table.HeaderCell>
        <Table.HeaderCell>Start</Table.HeaderCell>
        <Table.HeaderCell>End</Table.HeaderCell>
        <Table.HeaderCell>Traces</Table.HeaderCell>
      </Table.Row>
    </Table.Head>
    <Table.Body>
      {sessions.map((session) => (
        <Table.Row key={session.sessionId}>
          <Table.Cell>
            <a
              href={`/sessions/${encodeURIComponent(session.sessionId)}`}
              className="underline"
            >
              {session.sessionId}
            </a>
          </Table.Cell>
          <Table.Cell>{session.startTime}</Table.Cell>
          <Table.Cell>{session.endTime}</Table.Cell>
          <Table.Cell>{session.traceCount}</Table.Cell>
        </Table.Row>
      ))}
    </Table.Body>
  </Table>
);
