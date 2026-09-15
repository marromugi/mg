import type { Meta, StoryObj } from "@storybook/react-vite";
import { parseScheme } from "../../../scheme.js";
import { sessionSummaries } from "../../../stories/fixtures.js";
import { SessionsPage } from "./SessionsPage.js";

const meta = {
  component: SessionsPage,
} satisfies Meta<typeof SessionsPage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const ThreeSessions: Story = {
  args: {
    sessions: sessionSummaries,
    scheme: "system",
  },
  render: (args, { globals }) => (
    <SessionsPage {...args} scheme={parseScheme(globals.scheme)} />
  ),
};

export const Empty: Story = {
  args: {
    sessions: [],
    scheme: "system",
  },
  render: (args, { globals }) => (
    <SessionsPage {...args} scheme={parseScheme(globals.scheme)} />
  ),
};
