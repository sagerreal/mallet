import type { ReactNode } from "react";

export type Column<T> = { key: string; header: string; render: (row: T) => ReactNode; hideOnMobile?: boolean };

export function DataTable<T>({ columns, rows, rowKey, onRowClick, empty }: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  empty: ReactNode;
}) {
  if (rows.length === 0) return <>{empty}</>;
  const clickable = onRowClick ? "cursor-pointer hover:bg-paper" : "";
  return (
    <div>
      <table className="hidden w-full border-collapse md:table">
        <thead>
          <tr className="border-b border-line text-left">
            {columns.map((c) => (
              <th key={c.key} className="px-3 py-2 text-xs font-medium text-ink-muted">{c.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} className={`border-b border-line ${clickable}`} onClick={() => onRowClick?.(row)}>
              {columns.map((c) => (
                <td key={c.key} className="px-3 py-3 text-sm">{c.render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="space-y-2 md:hidden">
        {rows.map((row) => (
          <li key={rowKey(row)} className={`rounded-card border border-line bg-card p-3 ${clickable}`} onClick={() => onRowClick?.(row)}>
            {columns.filter((c) => !c.hideOnMobile).map((c) => (
              <div key={c.key} className="flex items-center justify-between py-0.5 text-sm">
                <span className="text-xs text-ink-muted">{c.header}</span>
                <span>{c.render(row)}</span>
              </div>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}
