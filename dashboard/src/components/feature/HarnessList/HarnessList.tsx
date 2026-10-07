import type { HarnessDefinition } from "../../../definition/index.js";
import { ArrowIcon, Avatar, Icon, Tag } from "../../ui/index.js";
import { useRows } from "./hooks/useRows.js";

// The saved agents, one row each: the face and name, the model it
// talks to, the tools it may use, and how they are guarded. A row
// opens its agent.
export const HarnessList = ({
  definitions,
}: {
  definitions: readonly HarnessDefinition[];
}) => {
  const rows = useRows(definitions);

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between rounded-control bg-surface px-4 control-py-2 text-xs">
        <h2>エージェント</h2>
        <p>{rows.length} 件</p>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-sm opacity-70">
          エージェントはまだありません。右上のボタンから作れます。
        </p>
      ) : (
        <ul className="flex flex-col">
          {rows.map((row) => (
            <li key={row.id}>
              <a
                href={row.href}
                className="flex items-center gap-4 rounded-control px-4 control-py-3 transition duration-160 ease-out hover:bg-surface"
              >
                <Avatar seed={row.seed} />
                <div className="min-w-0 flex-2">
                  <p className="truncate text-sm font-semibold">
                    {row.name}
                  </p>
                  <p className="truncate text-xs opacity-70">
                    {row.model}
                  </p>
                </div>
                <p className="w-28 shrink-0 text-sm">{row.provider}</p>
                <div className="flex min-w-0 flex-2 flex-wrap gap-2">
                  {row.tools.length === 0 ? (
                    <p className="text-xs opacity-70">会話のみ</p>
                  ) : (
                    row.tools.map((tool) => (
                      <Tag key={tool}>{tool}</Tag>
                    ))
                  )}
                </div>
                <div className="flex min-w-0 flex-1 flex-wrap gap-2">
                  {row.guards.map((guard) => (
                    <Tag key={guard}>{guard}</Tag>
                  ))}
                </div>
                <Icon icon={ArrowIcon} />
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
