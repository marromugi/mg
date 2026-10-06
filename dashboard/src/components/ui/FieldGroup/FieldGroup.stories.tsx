import type { Meta, StoryObj } from "@storybook/react";
import { FieldGroup } from "./FieldGroup.js";

const meta = { component: FieldGroup } satisfies Meta<
  typeof FieldGroup
>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { legend: "ツール", children: "中身" },
};

export const WithHintAndError: Story = {
  args: {
    legend: "パスのルール",
    hint: "上から順に並べます。",
    error: "ルールか判定 LLM が要ります",
    children: "中身",
  },
};
