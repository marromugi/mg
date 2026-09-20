import type {
  Meta as StoryMeta,
  StoryObj,
} from "@storybook/react-vite";
import { Meta } from "./Meta.js";

const START_TIME = "2026-01-01T00:00:00.000Z";
const END_TIME = "2026-01-01T00:00:01.000Z";

const meta = {
  component: Meta,
} satisfies StoryMeta<typeof Meta>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: `${START_TIME} – ${END_TIME}`,
  },
};
