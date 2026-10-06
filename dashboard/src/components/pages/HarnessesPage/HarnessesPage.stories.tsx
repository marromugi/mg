import type { Meta, StoryObj } from "@storybook/react";
import {
  chatHarness,
  filesHarness,
} from "../../../stories/fixtures.js";
import { HarnessesPage } from "./HarnessesPage.js";

const meta = {
  component: HarnessesPage,
} satisfies Meta<typeof HarnessesPage>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  args: { definitions: [], unreadable: [] },
};

export const Populated: Story = {
  args: {
    definitions: [chatHarness, filesHarness],
    unreadable: ["broken.json"],
  },
};

export const ListFailed: Story = {
  args: {
    definitions: [],
    unreadable: [],
    failure: "ENOTDIR: not a directory",
  },
};
