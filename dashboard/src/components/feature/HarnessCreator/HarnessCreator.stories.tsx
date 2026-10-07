import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { Button } from "../../ui/index.js";
import type { Creation } from "./hooks/useCreation.js";
import { emptyValues, type HarnessValues } from "./schema.js";
import { HarnessCreator } from "./HarnessCreator.js";

const filled: HarnessValues = {
  ...emptyValues,
  name: "files",
  model: { custom: false, listed: "openai/gpt-4o", typed: "" },
  tools: ["read_file", "grep", "edit_file"],
  root: "/Users/me/project",
  paths: [{ value: "src/**" }, { value: "docs/**" }],
};

const meta = {
  component: HarnessCreator,
  parameters: { layout: "fullscreen" },
  args: {
    open: true,
    onOpenChange: () => {},
    onCreate: () => Promise.resolve({ kind: "saved" }),
  },
} satisfies Meta<typeof HarnessCreator>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Name: Story = {};

export const Model: Story = {
  args: { initialValues: filled, initialStep: "model" },
};

export const ModelByHand: Story = {
  args: {
    initialStep: "model",
    initialValues: {
      ...filled,
      model: {
        custom: true,
        listed: "",
        typed: "anthropic/claude-sonnet",
      },
    },
  },
};

export const ModelOnOllama: Story = {
  args: {
    initialStep: "model",
    initialValues: {
      ...filled,
      provider: "ollama",
      model: { custom: false, listed: "", typed: "llama3.3" },
    },
  },
};

export const Tools: Story = {
  args: { initialValues: filled, initialStep: "tools" },
};

export const Security: Story = {
  args: { initialValues: filled, initialStep: "security" },
};

export const SecurityWithGate: Story = {
  args: {
    initialStep: "security",
    initialValues: {
      ...filled,
      gate: true,
      gateQuestion: "この操作は、作業フォルダの中だけを変更しますか。",
    },
  },
};

export const Other: Story = {
  args: { initialValues: filled, initialStep: "other" },
};

const WholeFlow = () => {
  const [open, setOpen] = useState(true);
  const [created, setCreated] = useState<Creation>();
  return (
    <div className="flex flex-col gap-3 p-6">
      <div>
        <Button type="button" onClick={() => setOpen(true)}>
          エージェントを作る
        </Button>
      </div>
      {created === undefined ? null : (
        <pre className="text-xs">
          {JSON.stringify(created, null, 2)}
        </pre>
      )}
      <HarnessCreator
        open={open}
        onOpenChange={setOpen}
        onCreate={(creation) => {
          setCreated(creation);
          setOpen(false);
          return Promise.resolve({ kind: "saved" });
        }}
      />
    </div>
  );
};

// Goes through every step from the start and shows what comes out at
// the end.
export const FromStartToEnd: Story = { render: () => <WholeFlow /> };
