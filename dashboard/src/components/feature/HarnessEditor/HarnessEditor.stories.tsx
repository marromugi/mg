import type { Meta, StoryObj } from "@storybook/react";
import {
  filesDraft,
  judgedDraft,
  newDraft,
} from "../../../stories/fixtures.js";
import { HarnessEditor } from "./HarnessEditor.js";

const meta = { component: HarnessEditor } satisfies Meta<
  typeof HarnessEditor
>;
export default meta;
type Story = StoryObj<typeof meta>;

export const New: Story = {
  args: { action: "/harnesses/new", draft: newDraft, problems: [] },
};

export const Editing: Story = {
  args: {
    action: "/harnesses/0b1c2d3e",
    draft: filesDraft,
    problems: [],
    deleteHref: "/harnesses/0b1c2d3e/delete",
  },
};

export const WithJudge: Story = {
  args: {
    action: "/harnesses/4f5a6b7c",
    draft: judgedDraft,
    problems: [],
  },
};

export const WithProblems: Story = {
  args: {
    action: "/harnesses/new",
    draft: { ...filesDraft, name: "", rules: [] },
    problems: [
      { field: "name", message: "名前を入力してください" },
      {
        field: "rules",
        message:
          "ツールを使うハーネスには、パスのルールか判定 LLM が要ります",
      },
    ],
  },
};

export const WriteFailed: Story = {
  args: {
    action: "/harnesses/new",
    draft: filesDraft,
    problems: [],
    failure: "EACCES: permission denied",
  },
};
