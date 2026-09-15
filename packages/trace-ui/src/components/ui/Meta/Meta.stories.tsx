import type {
  Meta as StoryMeta,
  StoryObj,
} from "@storybook/react-vite";
import { END_TIME, START_TIME } from "../../../stories/fixtures.js";
import { Meta } from "./Meta.js";

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
