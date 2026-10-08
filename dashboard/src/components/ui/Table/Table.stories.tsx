import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { PlusIcon } from "../Icon/index.js";
import { Button } from "../Button/index.js";
import { IconButton } from "../IconButton/index.js";
import { Table, type Column } from "./Table.js";

type Task = {
  key: string;
  name: string;
  status: "進行中" | "未着手" | "保留";
  due: string;
};

const tasks: Task[] = [
  {
    key: "DSH-27",
    name: "使い勝手のテスト",
    status: "進行中",
    due: "2025-02-20",
  },
  {
    key: "DSH-5",
    name: "利用者への聞き取り",
    status: "進行中",
    due: "2025-02-25",
  },
  {
    key: "DSH-12",
    name: "ユーザーストーリーの作成",
    status: "未着手",
    due: "2025-03-12",
  },
  {
    key: "DSH-38",
    name: "操作できる試作",
    status: "保留",
    due: "2025-03-18",
  },
  {
    key: "DSH-16",
    name: "利用の流れの整理",
    status: "保留",
    due: "2025-03-21",
  },
];

const columns: Column<Task>[] = [
  { id: "key", header: "キー", cell: (task) => task.key, width: 110 },
  { id: "name", header: "名前", cell: (task) => task.name, width: 260 },
  {
    id: "status",
    header: "状態",
    width: 130,
    cell: (task) => (
      <span className="rounded-control border border-edge bg-surface-raised px-2 control-py-0 text-xs">
        {task.status}
      </span>
    ),
  },
  { id: "due", header: "期日", cell: (task) => task.due, width: 140 },
];

const rowId = (task: Task) => task.key;

const meta: Meta<typeof Table<Task>> = {
  component: Table,
  args: { label: "タスク", rows: tasks, rowId, columns },
};
export default meta;
type Story = StoryObj<typeof Table<Task>>;

export const Default: Story = {};

export const Selectable: Story = {
  args: { selection: "multiple", defaultSelected: ["DSH-5", "DSH-12"] },
};

export const AllSelected: Story = {
  args: {
    selection: "multiple",
    defaultSelected: tasks.map((task) => task.key),
  },
};

// The last header holds a control of its own, and its column cannot be
// resized.
export const FreeHeader: Story = {
  args: {
    columns: [
      ...columns,
      {
        id: "add",
        width: 64,
        resize: "fixed",
        header: (
          <IconButton icon={PlusIcon} label="列を足す" type="button" />
        ),
        cell: () => null,
      },
    ],
  },
};

const HeldOutside = () => {
  const [selected, setSelected] = useState<string[]>(["DSH-27"]);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3 text-sm">
        <span>{selected.length} 件を選択中</span>
        <Button type="button" size="sm" onClick={() => setSelected([])}>
          選択を外す
        </Button>
      </div>
      <Table
        label="タスク"
        rows={tasks}
        rowId={rowId}
        columns={columns}
        selection="multiple"
        selected={selected}
        onSelectedChange={setSelected}
      />
    </div>
  );
};

// The story holds the selection, shows how many rows are selected, and
// clears it from outside the table.
export const SelectionHeldOutside: Story = {
  render: () => <HeldOutside />,
};
