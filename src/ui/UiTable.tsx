import type { ReactNode } from "react";

export interface UiColumn<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  /** Tailwind width class, e.g. "w-40"; the column without one takes the rest. */
  width?: string;
  align?: "start" | "end";
}

interface UiTableProps<T> {
  columns: UiColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  empty?: ReactNode;
  /** Makes rows clickable. */
  onRowPress?: (row: T) => void;
}

export function UiTable<T>({ columns, rows, rowKey, empty, onRowPress }: UiTableProps<T>) {
  if (rows.length === 0 && empty) return <>{empty}</>;
  return (
    <div className="hairline overflow-hidden rounded-[var(--radius-panel)] bg-well">
      <table className="w-full table-fixed border-collapse text-left">
        <thead>
          <tr className="hairline-b">
            {columns.map((column) => (
              <th
                key={column.key}
                className={[
                  "px-3 py-2 text-[0.6875rem] font-medium text-ink-faint",
                  column.width ?? "",
                  column.align === "end" ? "text-right" : "",
                ].join(" ")}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className={`hairline-b last:border-b-0 hover:bg-hover ${onRowPress ? "cursor-pointer" : ""}`}
              onClick={onRowPress ? () => onRowPress(row) : undefined}
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={["px-3 py-2 align-middle", column.align === "end" ? "text-right" : ""].join(" ")}
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
