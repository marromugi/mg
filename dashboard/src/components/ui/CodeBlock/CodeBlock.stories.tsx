import type { Meta, StoryObj } from "@storybook/react";
import { CodeBlock } from "./CodeBlock.js";

const meta = {
  component: CodeBlock,
  decorators: [
    (Story) => (
      <div className="max-w-page p-6">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof CodeBlock>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Json: Story = {
  args: {
    language: "json",
    code: '{\n  "path": "package.json",\n  "limit": 20\n}',
  },
};

export const TypeScript: Story = {
  args: {
    language: "typescript",
    code: "export const greet = (name: string): string =>\n  `hello, ${name}`;",
  },
};

export const PlainText: Story = {
  args: { language: "text", code: "1\tThe secret word is: walnut" },
};

export const Numbered: Story = {
  args: {
    language: "typescript",
    startLine: 98,
    code: "const a = 1;\nconst b = 2;\nconst c = a + b;",
  },
};
