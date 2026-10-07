import type { Meta, StoryObj } from "@storybook/react";
import {
  HomeIcon,
  KeyIcon,
  ListIcon,
  LogoIcon,
  ThemeIcon,
  Icon,
} from "../Icon/index.js";
import { IconButton } from "../IconButton/index.js";
import { Sidebar } from "./Sidebar.js";

const meta = {
  component: Sidebar,
  decorators: [
    (Story) => (
      <div className="h-screen p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Sidebar>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    label: "メイン",
    top: (
      <span className="inline-flex size-10 items-center justify-center">
        <Icon icon={LogoIcon} size="lg" tone="accent" />
      </span>
    ),
    bottom: (
      <IconButton
        icon={ThemeIcon}
        label="テーマを切り替える"
        name="theme"
        value="toggle"
      />
    ),
    children: (
      <>
        <IconButton
          icon={HomeIcon}
          label="ホーム"
          href="/"
          state="current"
        />
        <IconButton
          icon={ListIcon}
          label="ハーネス"
          href="/harnesses"
        />
        <IconButton icon={KeyIcon} label="API キー" href="/api-keys" />
      </>
    ),
  },
};
