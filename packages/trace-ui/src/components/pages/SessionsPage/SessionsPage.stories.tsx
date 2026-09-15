import type { Meta, StoryObj } from "@storybook/react-vite";
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
  },
};

export const Empty: Story = {
  args: {
    sessions: [],
  },
};
