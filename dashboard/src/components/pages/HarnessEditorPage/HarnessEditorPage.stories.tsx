import type { Meta, StoryObj } from "@storybook/react";
import { filesDraft, newDraft } from "../../../stories/fixtures.js";
import { HarnessEditorPage } from "./HarnessEditorPage.js";

const meta = {
  component: HarnessEditorPage,
} satisfies Meta<typeof HarnessEditorPage>;
export default meta;
type Story = StoryObj<typeof meta>;

export const New: Story = {
  args: { target: { kind: "new" }, draft: newDraft, problems: [] },
};

export const Edit: Story = {
  args: {
    target: { kind: "edit", id: "0b1c2d3e" },
    draft: filesDraft,
    problems: [],
  },
};
