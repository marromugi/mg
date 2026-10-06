import type { HarnessDefinition } from "../../../definition/index.js";
import { EmptyState, Notice, Table, TextLink } from "../../ui/index.js";
import { useHarnessList } from "./hooks/useHarnessList.js";

export const HarnessList = ({
  definitions,
  unreadable,
}: {
  definitions: readonly HarnessDefinition[];
  unreadable: readonly string[];
}) => {
  const rows = useHarnessList(definitions);

  return (
    <div className="flex flex-col gap-4">
      {unreadable.length === 0 ? null : (
        <Notice>
          <p>
            読み込めないファイルがあります。開かずに、そのまま残しています。
          </p>
          <ul className="mt-2 list-disc pl-6">
            {unreadable.map((file) => (
              <li key={file}>{file}</li>
            ))}
          </ul>
        </Notice>
      )}
      {rows.length === 0 ? (
        <EmptyState title="ハーネスはまだありません" />
      ) : (
        <Table
          headings={["名前", "プロバイダー", "モデル", "ツール"]}
          rows={rows.map((row) => ({
            key: row.id,
            cells: [
              <TextLink key="name" href={row.href}>
                {row.name}
              </TextLink>,
              row.provider,
              row.model,
              row.tools,
            ],
          }))}
        />
      )}
    </div>
  );
};
