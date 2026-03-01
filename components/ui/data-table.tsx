"use client";

import { useState, useCallback } from "react";

export interface Column<T> {
  /** Unique column identifier. Use a real field name for default rendering/sorting, or any unique string for render-only columns. */
  key: (keyof T & string) | (string & {});
  label: string;
  sortable?: boolean;
  render?: (row: T) => React.ReactNode;
  /** Custom sort value extractor — use for computed columns that don't map to a field. */
  getValue?: (row: T) => string | number | null;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string;
}

export function DataTable<T extends object>({
  columns,
  data,
  onRowClick,
  rowClassName,
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const handleSort = useCallback(
    (key: string) => {
      if (sortKey === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortKey(key);
        setSortDir("asc");
      }
    },
    [sortKey]
  );

  const sortedData = [...data];
  if (sortKey) {
    const sortCol = columns.find((c) => c.key === sortKey);
    sortedData.sort((a, b) => {
      const aVal = sortCol?.getValue
        ? sortCol.getValue(a)
        : sortKey in a ? (a as Record<string, unknown>)[sortKey] : null;
      const bVal = sortCol?.getValue
        ? sortCol.getValue(b)
        : sortKey in b ? (b as Record<string, unknown>)[sortKey] : null;
      if (aVal == null || bVal == null) return 0;
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDir === "asc" ? aVal - bVal : bVal - aVal;
      }
      const aStr = String(aVal);
      const bStr = String(bVal);
      return sortDir === "asc"
        ? aStr.localeCompare(bStr)
        : bStr.localeCompare(aStr);
    });
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm text-left">
        <thead>
          <tr className="border-b border-border">
            {columns.map((col) => (
              <th
                key={col.key}
                className={`px-4 py-3 text-xs font-display font-semibold text-text-tertiary uppercase tracking-wider ${
                  col.sortable ? "cursor-pointer select-none hover:text-text-primary" : ""
                }`}
                onClick={col.sortable ? () => handleSort(col.key) : undefined}
              >
                <span className="inline-flex items-center gap-1">
                  {col.label}
                  {col.sortable && sortKey === col.key && (
                    <span className="text-text-secondary">
                      {sortDir === "asc" ? "\u25B2" : "\u25BC"}
                    </span>
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedData.map((row, i) => (
            <tr
              key={i}
              className={`border-b border-border transition-colors ${
                onRowClick ? "cursor-pointer hover:bg-surface-hover" : ""
              } ${rowClassName ? rowClassName(row) : ""}`}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columns.map((col) => (
                <td key={col.key} className="px-4 py-3 text-text-primary">
                  {col.render
                    ? col.render(row)
                    : String(col.key in row ? (row as Record<string, unknown>)[col.key] ?? "" : "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
