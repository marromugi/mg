import type { Meta, StoryObj } from "@storybook/react-vite";
import { sessionTree } from "../../../stories/fixtures.js";
import { SessionPage } from "./SessionPage.js";

const meta = {
  component: SessionPage,
} satisfies Meta<typeof SessionPage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    session: sessionTree,
  },
};
