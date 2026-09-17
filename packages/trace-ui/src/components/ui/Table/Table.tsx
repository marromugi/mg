import type { ReactNode } from "react";
import { tv } from "tailwind-variants";

const cell = tv({
  base: "border-b border-edge px-3 py-2.5",
  variants: {
    kind: {
      header: "text-meta font-semibold",
      data: "",
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
  <tr>{children}</tr>
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
    <table className="w-full">{children}</table>
  </div>
)) as TableComponent;

Table.Head = Head;
Table.Body = Body;
Table.Row = Row;
Table.HeaderCell = HeaderCell;
Table.Cell = Cell;
