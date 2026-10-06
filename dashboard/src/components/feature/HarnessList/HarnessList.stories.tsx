import type { Meta, StoryObj } from "@storybook/react";
import {
  chatHarness,
  filesHarness,
  judgedHarness,
} from "../../../stories/fixtures.js";
import { HarnessList } from "./HarnessList.js";

const meta = { component: HarnessList } satisfies Meta<
  typeof HarnessList
>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  args: { definitions: [], unreadable: [] },
};

export const Populated: Story = {
  args: {
    definitions: [chatHarness, filesHarness, judgedHarness],
    unreadable: [],
  },
};

export const WithUnreadableFile: Story = {
  args: {
    definitions: [filesHarness],
    unreadable: ["broken.json"],
  },
};
