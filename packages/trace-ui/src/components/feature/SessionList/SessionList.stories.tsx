import type { Meta, StoryObj } from "@storybook/react-vite";
import { sessionSummaries } from "../../../stories/fixtures.js";
import { SessionList } from "./SessionList.js";

const meta = {
  component: SessionList,
} satisfies Meta<typeof SessionList>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Populated: Story = {
  args: {
    sessions: sessionSummaries,
  },
};

export const Empty: Story = {
  args: {
    sessions: [],
  },
};
