import type { Meta, StoryObj } from "@storybook/react-vite";
import { llmNode, toolNode } from "../../../stories/fixtures.js";
import { ATTR } from "../../../vocabulary.js";
import { ChatMessages } from "./ChatMessages.js";

const meta = {
  component: ChatMessages,
} satisfies Meta<typeof ChatMessages>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Parsed: Story = {
  args: {
    label: "Input",
    raw: llmNode.attributes[ATTR.llmInputMessages] as string,
  },
};

export const UnparsableRaw: Story = {
  args: {
    label: "Result",
    raw: toolNode.attributes[ATTR.toolResult] as string,
  },
};
