import type { ReactNode } from "react";

type TableProps = {
  headings: readonly string[];
  rows: readonly { key: string; cells: readonly ReactNode[] }[];
};

export const Table = ({ headings, rows }: TableProps) => (
  <table className="w-full border-collapse text-left">
    <thead>
      <tr>
        {headings.map((heading) => (
          <th
            key={heading}
            scope="col"
            className="border-b border-edge py-2 pr-4 font-semibold"
          >
            {heading}
          </th>
        ))}
      </tr>
    </thead>
    <tbody>
      {rows.map((row) => (
        <tr key={row.key}>
          {row.cells.map((cell, index) => (
            <td
              key={headings[index] ?? index}
              className="border-b border-edge py-2 pr-4"
            >
              {cell}
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  </table>
);
