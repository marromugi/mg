import type { Meta, StoryObj } from "@storybook/react-vite";
import { sessionSummaries } from "../../../stories/fixtures.js";
import { Table } from "./Table.js";

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
