import type { Meta, StoryObj } from "@storybook/react-vite";
import { rootNode } from "../../../stories/fixtures.js";
import { SpanTree } from "./SpanTree.js";

const meta = {
  component: SpanTree,
} satisfies Meta<typeof SpanTree>;

export default meta;

type Story = StoryObj<typeof meta>;

export const NestedWithError: Story = {
  args: {
    node: rootNode,
  },
};
