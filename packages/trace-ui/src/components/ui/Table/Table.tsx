import type { ReactNode } from "react";

const CELL = "border-b border-edge px-2.5 py-1.5 text-left";

const Head = ({ children }: { children: ReactNode }) => (
  <thead>
    <tr>{children}</tr>
  </thead>
);

const Body = ({ children }: { children: ReactNode }) => (
  <tbody>{children}</tbody>
);

const Row = ({ children }: { children: ReactNode }) => (
  <tr>{children}</tr>
);

const HeaderCell = ({ children }: { children: ReactNode }) => (
  <th className={CELL}>{children}</th>
);

const Cell = ({ children }: { children: ReactNode }) => (
  <td className={CELL}>{children}</td>
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
  <table className="w-full">{children}</table>
)) as TableComponent;

Table.Head = Head;
Table.Body = Body;
Table.Row = Row;
Table.HeaderCell = HeaderCell;
Table.Cell = Cell;
