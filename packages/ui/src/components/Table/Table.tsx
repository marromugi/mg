import type { ReactNode } from "react";
import { tv } from "tailwind-variants";

const cell = tv({
  variants: {
    kind: {
      header:
        "rounded-control bg-edge/50 px-4 control-py-3 text-meta font-semibold not-first:rounded-l-none not-last:rounded-r-none",
      data: "border-b border-edge px-4 py-3.5 group-last:border-b-0",
    },
    align: {
      start: "text-left",
      end: "text-right tabular-nums",
    },
  },
  defaultVariants: { align: "start" },
});

type CellProps = {
  align?: "start" | "end";
  children: ReactNode;
};

const Head = ({ children }: { children: ReactNode }) => (
  <thead>{children}</thead>
);

const Body = ({ children }: { children: ReactNode }) => (
  <tbody>{children}</tbody>
);

const Row = ({ children }: { children: ReactNode }) => (
  <tr className="group">{children}</tr>
);

const HeaderCell = ({ align, children }: CellProps) => (
  <th scope="col" className={cell({ kind: "header", align })}>
    {children}
  </th>
);

const Cell = ({ align, children }: CellProps) => (
  <td className={cell({ kind: "data", align })}>{children}</td>
);

type TableComponent = ((props: {
  children: ReactNode;
}) => ReactNode) & {
  Head: typeof Head;
  Body: typeof Body;
  Row: typeof Row;
  HeaderCell: typeof HeaderCell;
  Cell: typeof Cell;
};

export const Table = (({ children }: { children: ReactNode }) => (
  <div className="overflow-x-auto">
    <table className="w-full border-separate border-spacing-0">
      {children}
    </table>
  </div>
)) as TableComponent;

Table.Head = Head;
Table.Body = Body;
Table.Row = Row;
Table.HeaderCell = HeaderCell;
Table.Cell = Cell;
