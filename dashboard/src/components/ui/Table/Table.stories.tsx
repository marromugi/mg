import type { Meta, StoryObj } from "@storybook/react";
import { Table } from "./Table.js";

const meta = { component: Table } satisfies Meta<typeof Table>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Rows: Story = {
  args: {
    headings: ["名前", "モデル"],
    rows: [
      { key: "a", cells: ["files", "deepseek/deepseek-v4-flash"] },
      { key: "b", cells: ["chat", "llama3"] },
    ],
  },
};
