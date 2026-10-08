import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { Button } from "../Button/index.js";
import { Checkbox } from "../Checkbox/index.js";
import { Select } from "../Select/index.js";
import { TextArea } from "../TextArea/index.js";
import { TextField } from "../TextField/index.js";
import { Modal } from "./Modal.js";

const providers = [
  { value: "openrouter", label: "OpenRouter" },
  { value: "ollama", label: "Ollama" },
];

const shortForm = (
  <div className="flex flex-col gap-4">
    <TextField name="name" label="名前" placeholder="files" />
    <Select name="provider" label="プロバイダー" options={providers} />
  </div>
);

const longForm = (
  <div className="flex flex-col gap-4">
    <TextField name="name" label="名前" placeholder="files" />
    <Select name="provider" label="プロバイダー" options={providers} />
    <TextField name="model" label="モデル" value="openai/gpt-5" />
    <TextField
      name="maxTurns"
      label="ターン数の上限"
      type="number"
      value="10"
    />
    <TextArea name="paths" label="パスのパターン" rows={5} />
    <Checkbox name="tools" value="bash" label="bash" />
    <Checkbox name="tools" value="read_file" label="read_file" />
    <Checkbox name="tools" value="grep" label="grep" />
    <TextArea name="instruction" label="判定の指示" rows={6} />
  </div>
);

const actions = (
  <>
    <Button type="button">下書き</Button>
    <Button type="button" tone="primary">
      保存
    </Button>
  </>
);

const meta: Meta<typeof Modal> = {
  component: Modal,
  parameters: { layout: "fullscreen" },
  args: {
    title: "エージェントを作る",
    defaultOpen: true,
    actions,
    children: shortForm,
  },
};
export default meta;
type Story = StoryObj<typeof Modal>;

export const Default: Story = {};

export const WithTrigger: Story = {
  args: {
    defaultOpen: false,
    trigger: <Button>エージェントを作る</Button>,
  },
  decorators: [
    (Story) => (
      <div className="p-6">
        <Story />
      </div>
    ),
  ],
};

export const WithoutTitle: Story = {
  args: { title: undefined, label: "エージェントを作る" },
};

export const WithoutCloseButton: Story = {
  args: { closeButton: "hidden" },
};

export const WithoutActions: Story = { args: { actions: undefined } };

// Taller than the window: the form scrolls under the actions.
export const LongContent: Story = { args: { children: longForm } };

const KeptUntilClosed = () => {
  const [open, setOpen] = useState(true);
  return (
    <div className="p-6">
      <Button type="button" onClick={() => setOpen(true)}>
        エージェントを作る
      </Button>
      <Modal
        title="エージェントを作る"
        dismiss="explicit"
        open={open}
        onOpenChange={setOpen}
        actions={
          <>
            <Button type="button" onClick={() => setOpen(false)}>
              キャンセル
            </Button>
            <Button
              type="button"
              tone="primary"
              onClick={() => setOpen(false)}
            >
              保存
            </Button>
          </>
        }
      >
        {longForm}
      </Modal>
    </div>
  );
};

// A press outside or Escape leaves it open; only its own controls close
// it.
export const ExplicitDismiss: Story = {
  render: () => <KeptUntilClosed />,
};
