import type { Meta, StoryObj } from "@storybook/react-vite";
import { Table } from "./Table.js";

const sessionSummaries = [
  { sessionId: "session-1", startTime: "2026-01-01T00:00:00.000Z" },
  { sessionId: "session-2", startTime: "2026-01-01T00:02:00.000Z" },
  { sessionId: "session-3", startTime: "2026-01-01T00:03:00.000Z" },
];

const meta = {
  component: Table,
} satisfies Meta<typeof Table>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: (
      <>
        <Table.Head>
          <Table.Row>
            <Table.HeaderCell>Session</Table.HeaderCell>
            <Table.HeaderCell>Start</Table.HeaderCell>
          </Table.Row>
        </Table.Head>
        <Table.Body>
          {sessionSummaries.map((session) => (
            <Table.Row key={session.sessionId}>
              <Table.Cell>{session.sessionId}</Table.Cell>
              <Table.Cell>{session.startTime}</Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </>
    ),
  },
};
