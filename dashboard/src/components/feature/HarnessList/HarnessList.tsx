import type { HarnessDefinition } from "../../../definition/index.js";
import {
  ArrowIcon,
  Avatar,
  IconButton,
  Table,
  Tag,
  type Column,
} from "../../ui/index.js";
import { useRows, type Row } from "./hooks/useRows.js";

const COLUMNS: readonly Column<Row>[] = [
  {
    id: "agent",
    header: "エージェント",
    width: 260,
    minWidth: 160,
    cell: (row) => (
      <a href={row.href} className="flex items-center gap-3">
        <Avatar seed={row.seed} />
        <span className="min-w-0">
          <span className="block truncate font-semibold">
            {row.name}
          </span>
          <span className="block truncate text-xs opacity-70">
            {row.model}
          </span>
        </span>
      </a>
    ),
  },
  {
    id: "provider",
    header: "プロバイダー",
    width: 130,
    cell: (row) => row.provider,
  },
  {
    id: "tools",
    header: "ツール",
    width: 280,
    cell: (row) =>
      row.tools.length === 0 ? (
        <span className="text-xs opacity-70">会話のみ</span>
      ) : (
        <span className="flex flex-wrap gap-2">
          {row.tools.map((tool) => (
            <Tag key={tool}>{tool}</Tag>
          ))}
        </span>
      ),
  },
  {
    id: "guards",
    header: "守り方",
    width: 180,
    cell: (row) => (
      <span className="flex flex-wrap gap-2">
        {row.guards.map((guard) => (
          <Tag key={guard}>{guard}</Tag>
        ))}
      </span>
    ),
  },
  {
    id: "open",
    header: <span className="sr-only">開く</span>,
    width: 56,
    resize: "fixed",
    cell: (row) => (
      <IconButton
        icon={ArrowIcon}
        label={`${row.name} を開く`}
        labelSide="left"
        size="sm"
        href={row.href}
      />
    ),
  },
];

// The saved agents as a table, one row each: the face and name, the
// model it talks to, the tools it may use, and how they are guarded.
// A row opens its agent.
export const HarnessList = ({
  definitions,
}: {
  definitions: readonly HarnessDefinition[];
}) => {
  const rows = useRows(definitions);

  if (rows.length === 0) {
    return (
      <p className="px-4 py-6 text-sm opacity-70">
        エージェントはまだありません。右上のボタンから作れます。
      </p>
    );
  }
  return (
    <Table
      label="エージェント"
      rows={rows}
      rowId={(row) => row.id}
      columns={COLUMNS}
    />
  );
};
