import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { Button } from "../Button/index.js";
import { Popover } from "./Popover.js";

const meta: Meta<typeof Popover> = {
  component: Popover,
  args: {
    defaultOpen: true,
    trigger: <Button>開く</Button>,
    children: (
      <div className="flex w-56 flex-col gap-2 rounded-container border border-edge bg-surface-raised container-p-3 text-sm">
        <p className="font-semibold">中身は自由です</p>
        <p className="opacity-70">
          面の色も余白も、中に置く要素が決めます。
        </p>
      </div>
    ),
  },
  decorators: [
    (Story) => (
      <div className="flex h-96 items-center justify-center">
        <Story />
      </div>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof Popover>;

export const BottomStart: Story = {};

export const Closed: Story = { args: { defaultOpen: false } };

export const RightCenter: Story = {
  args: { direction: "right", align: "center" },
};

export const TopEnd: Story = {
  args: { direction: "top", align: "end" },
};

export const LeftStart: Story = {
  args: { direction: "left", align: "start" },
};

export const FarOffset: Story = {
  args: { direction: "bottom", align: "center", offset: 24 },
};

// The trigger sits in the bottom-right corner, where there is no room
// below or to the right, so the popover moves to stay in view.
export const KeptInView: Story = {
  args: { direction: "bottom", align: "start" },
  decorators: [
    (Story) => (
      <div className="fixed right-2 bottom-2">
        <Story />
      </div>
    ),
  ],
};

const HeldOutside = () => {
  const [open, setOpen] = useState(true);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger={<Button>開く</Button>}
    >
      <div className="flex w-56 flex-col gap-3 rounded-container border border-edge bg-surface-raised container-p-3 text-sm">
        <p>中のボタンから閉じられます。</p>
        <Button type="button" size="sm" onClick={() => setOpen(false)}>
          閉じる
        </Button>
      </div>
    </Popover>
  );
};

// The story holds the open state and closes the popover from inside it.
export const Controlled: Story = { render: () => <HeldOutside /> };
