import type { Meta, StoryObj } from "@storybook/react";
import { Markdown } from "./Markdown.js";

const ANSWER = `# 見出し

これは **重要** な説明で、\`code\` や [リンク](https://example.com) を含みます。

- 最初の項目
- 次の項目

| 名前 | 値 |
| --- | --- |
| 幅 | 広い |

\`\`\`ts
export const greet = (name: string) => \`hello, \${name}\`;
\`\`\`

> 引用です。`;

const meta = {
  component: Markdown,
  decorators: [
    (Story) => (
      <div className="max-w-page p-6 text-sm">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Markdown>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Complete: Story = { args: { text: ANSWER } };

export const ArrivingInBold: Story = {
  args: { text: "これは **重要な説", state: "arriving" },
};

export const ArrivingInCode: Story = {
  args: {
    text: "コードです。\n\n```ts\nexport const greet = (na",
    state: "arriving",
  },
};

export const UnclosedWhenComplete: Story = {
  args: { text: "これは **重要な説", state: "complete" },
};
