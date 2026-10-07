import type { Meta, StoryObj } from "@storybook/react";
import { PlusIcon } from "../../../stories/icons.js";
import { Button } from "../Button/index.js";
import { IconButton } from "../IconButton/index.js";
import { Header } from "./Header.js";

const meta = {
  component: Header,
  decorators: [
    (Story) => (
      <div className="p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Header>;
export default meta;
type Story = StoryObj<typeof meta>;

const add = (
  <IconButton
    icon={PlusIcon}
    label="ハーネスを作る"
    labelSide="bottom"
    href="/harnesses/new"
  />
);

export const Default: Story = { args: { end: add } };

export const WithStart: Story = {
  args: {
    start: (
      <>
        <Button href="/" size="md">
          ホーム
        </Button>
        <Button href="/harnesses" size="md">
          ハーネス
        </Button>
      </>
    ),
    end: add,
  },
};

export const Empty: Story = {};
