import type { Meta, StoryObj } from "@storybook/react";
import { EmptyState } from "./EmptyState.js";

const meta = { component: EmptyState } satisfies Meta<
  typeof EmptyState
>;
export default meta;
type Story = StoryObj<typeof meta>;

export const TitleOnly: Story = {
  args: { title: "まだ何もありません" },
};

export const WithDescription: Story = {
  args: {
    title: "まだ何もありません",
    children: "作成すると、ここに並びます。",
  },
};
