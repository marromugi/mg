import {
  columnResizingFeature,
  columnSizingFeature,
  rowSelectionFeature,
  tableFeatures,
  useTable,
  type ColumnDef,
  type RowData,
  type RowSelectionState,
  type Updater,
} from "@tanstack/react-table";
import { useMemo, useState, type ReactNode } from "react";
import { tv } from "tailwind-variants";
import { Checkbox } from "../Checkbox/index.js";
import {
  useSelectedIds,
  useSelectionRecord,
} from "./hooks/useSelection.js";

const features = tableFeatures({
  columnSizingFeature,
  columnResizingFeature,
  rowSelectionFeature,
});

const SELECT_COLUMN_WIDTH = 48;

const head = tv({
  base: "group/head relative bg-surface px-3 control-py-3 text-left text-xs font-semibold whitespace-nowrap",
  variants: {
    edge: {
      none: "",
      start: "rounded-control rounded-r-none rounded-bl-none",
      end: "rounded-control rounded-l-none rounded-br-none",
      both: "rounded-control rounded-b-none",
    },
  },
  defaultVariants: { edge: "none" },
});

const cell =
  "overflow-hidden border-b border-edge px-3 py-3 align-middle transition duration-160 ease-out group-hover/row:bg-surface group-data-selected/row:bg-surface";

// `header` and `cell` may draw anything. `width` is where the column
// starts, in pixels; with `resize` "free" its right edge can be dragged,
// never narrower than `minWidth`.
export type Column<Row> = {
  id: string;
  header: ReactNode;
  cell: (row: Row) => ReactNode;
  width?: number;
  minWidth?: number;
  resize?: "free" | "fixed";
};

// With `selection` "multiple" each row has a box and the header has one
// for all of them. Whoever passes `selected` holds the selection, so it
// must also take the changes.
type Selection =
  | {
      selection?: "none";
      selected?: undefined;
      onSelectedChange?: undefined;
      defaultSelected?: undefined;
    }
  | {
      selection: "multiple";
      selected: readonly string[];
      onSelectedChange: (ids: string[]) => void;
      defaultSelected?: undefined;
    }
  | {
      selection: "multiple";
      selected?: undefined;
      onSelectedChange?: (ids: string[]) => void;
      defaultSelected?: readonly string[];
    };

type TableProps<Row> = {
  label: string;
  rows: readonly Row[];
  rowId: (row: Row) => string;
  columns: readonly Column<Row>[];
} & Selection;

export const Table = <Row extends RowData>({
  label,
  rows,
  rowId,
  columns,
  selection = "none",
  selected,
  onSelectedChange,
  defaultSelected,
}: TableProps<Row>) => {
  const [ownSelection, setOwnSelection] = useState<RowSelectionState>(
    () => useSelectionRecord(defaultSelected ?? []),
  );
  const rowSelection =
    selected === undefined
      ? ownSelection
      : useSelectionRecord(selected);
  const selectable = selection === "multiple";

  const data = useMemo(() => [...rows], [rows]);
  const definitions = useMemo(
    () =>
      columns.map((column): ColumnDef<typeof features, Row> => ({
        id: column.id,
        header: () => column.header,
        cell: (context) => column.cell(context.row.original),
        size: column.width ?? 160,
        minSize: column.minWidth ?? 64,
        enableResizing: column.resize !== "fixed",
      })),
    [columns],
  );

  const table = useTable({
    features,
    data,
    columns: definitions,
    getRowId: rowId,
    columnResizeMode: "onChange",
    enableRowSelection: selectable,
    state: { rowSelection },
    onRowSelectionChange: (updater: Updater<RowSelectionState>) => {
      const next =
        typeof updater === "function" ? updater(rowSelection) : updater;
      if (selected === undefined) setOwnSelection(next);
      onSelectedChange?.(useSelectedIds(next));
    },
  });

  const headers = table
    .getHeaderGroups()
    .flatMap((group) => group.headers);
  const width =
    table.getTotalSize() + (selectable ? SELECT_COLUMN_WIDTH : 0);

  return (
    <div className="overflow-x-auto">
      <table
        aria-label={label}
        className="table-fixed border-separate border-spacing-0 text-sm"
        style={{ width }}
      >
        <thead>
          <tr>
            {selectable ? (
              <th
                className={head({ edge: "start" })}
                style={{ width: SELECT_COLUMN_WIDTH }}
              >
                <Checkbox
                  layout="bare"
                  label="すべての行を選ぶ"
                  checked={table.getIsAllRowsSelected()}
                  indeterminate={table.getIsSomeRowsSelected()}
                  onChange={(checked) =>
                    table.toggleAllRowsSelected(checked)
                  }
                />
              </th>
            ) : null}
            {headers.map((header, index) => {
              const first = index === 0 && !selectable;
              const last = index === headers.length - 1;
              return (
                <th
                  key={header.id}
                  className={head({
                    edge:
                      first && last
                        ? "both"
                        : first
                          ? "start"
                          : last
                            ? "end"
                            : "none",
                  })}
                  style={{ width: header.getSize() }}
                >
                  <table.FlexRender header={header} />
                  {header.column.getCanResize() ? (
                    <span
                      role="separator"
                      aria-orientation="vertical"
                      data-resizing={
                        header.column.getIsResizing() ? "" : undefined
                      }
                      onMouseDown={header.getResizeHandler()}
                      onTouchStart={header.getResizeHandler()}
                      className="absolute inset-y-2 right-0 w-1 cursor-col-resize touch-none rounded-full bg-edge opacity-0 transition duration-160 ease-out select-none group-hover/head:opacity-100 data-resizing:bg-accent data-resizing:opacity-100"
                    />
                  ) : null}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr
              key={row.id}
              data-selected={row.getIsSelected() ? "" : undefined}
              className="group/row"
            >
              {selectable ? (
                <td className={cell}>
                  <Checkbox
                    layout="bare"
                    label="この行を選ぶ"
                    checked={row.getIsSelected()}
                    onChange={(checked) => row.toggleSelected(checked)}
                  />
                </td>
              ) : null}
              {row.getAllCells().map((each) => (
                <td key={each.id} className={cell}>
                  <table.FlexRender cell={each} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
