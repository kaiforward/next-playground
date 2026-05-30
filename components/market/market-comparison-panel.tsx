"use client";

import { useMemo, useState } from "react";
import type { ConnectionInfo } from "@/lib/engine/navigation";
import { boundedHopsFromOrigin } from "@/lib/engine/pathfinding";
import { useMarketComparison } from "@/lib/hooks/use-market-comparison";
import { priceRampColor } from "@/lib/utils/price-ramp";
import { formatCredits } from "@/lib/utils/format";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { QueryBoundary } from "@/components/ui/query-boundary";

const MAX_HOPS = 6;
const GRID_COLS = "grid-cols-[1.4fr_0.6fr_0.7fr_0.7fr_64px]";

type SortKey = "price" | "stock" | "hops";
type SortDir = "asc" | "desc";
type FilterMode = "all" | "buy" | "sell";

const FILTER_MODES: FilterMode[] = ["all", "buy", "sell"];

interface MarketComparisonPanelProps {
  goodId: string;
  goodName: string;
  /** Origin system for "Jumps from" calculation. */
  fromSystemId: string;
  fromSystemName: string;
  /** System names + connections so we can label rows and BFS. */
  systems: { id: string; name: string }[];
  connections: ConnectionInfo[];
  /** Action when user clicks Go — recentre map + open detail panel. */
  onSelectSystem: (systemId: string) => void;
  onClose: () => void;
}

export function MarketComparisonPanel(props: MarketComparisonPanelProps) {
  return (
    <QueryBoundary>
      <MarketComparisonContent {...props} />
    </QueryBoundary>
  );
}

function MarketComparisonContent({
  goodId,
  goodName,
  fromSystemId,
  fromSystemName,
  systems,
  connections,
  onSelectSystem,
  onClose,
}: MarketComparisonPanelProps) {
  const { entries } = useMarketComparison(goodId);
  const [sortKey, setSortKey] = useState<SortKey>("price");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [filter, setFilter] = useState<FilterMode>("all");

  const nameById = useMemo(
    () => new Map(systems.map((s) => [s.id, s.name])),
    [systems],
  );
  const hopsMap = useMemo(
    () => boundedHopsFromOrigin(fromSystemId, connections, MAX_HOPS),
    [fromSystemId, connections],
  );

  const rows = useMemo(() => {
    const decorated = entries.map((e) => ({
      ...e,
      hops: hopsMap.get(e.systemId) ?? null,
      ratio: e.basePrice > 0 ? e.currentPrice / e.basePrice : 1,
      name: nameById.get(e.systemId) ?? "Unknown",
    }));
    const filtered = decorated.filter((d) => {
      if (filter === "buy") return d.ratio < 1.0;
      if (filter === "sell") return d.ratio > 1.0;
      return true;
    });
    const sign = sortDir === "asc" ? 1 : -1;
    const sorted = [...filtered].sort((a, b) => {
      const av =
        sortKey === "hops"
          ? a.hops ?? Number.POSITIVE_INFINITY
          : sortKey === "price"
            ? a.currentPrice
            : a.stock;
      const bv =
        sortKey === "hops"
          ? b.hops ?? Number.POSITIVE_INFINITY
          : sortKey === "price"
            ? b.currentPrice
            : b.stock;
      return (av - bv) * sign;
    });
    return sorted;
  }, [entries, filter, hopsMap, nameById, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  return (
    <aside className="fixed top-[84px] right-0 h-[calc(100%-84px)] w-96 bg-surface border-l-2 border-l-accent shadow-2xl z-50 flex flex-col">
      <header className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div>
          <h2 className="font-display uppercase tracking-wider text-text-accent text-sm">
            {goodName}
          </h2>
          <p className="text-xs text-text-tertiary">
            from <span className="text-text-secondary">{fromSystemName}</span>{" "}
            &middot; {rows.length} visible{" "}
            {rows.length === 1 ? "market" : "markets"}
          </p>
        </div>
        <button
          onClick={onClose}
          aria-label="Close comparison panel"
          className="text-text-tertiary hover:text-text-primary p-1"
        >
          &times;
        </button>
      </header>

      {/* Filter chips */}
      <div className="flex gap-1.5 px-4 py-2 border-b border-border">
        {FILTER_MODES.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-xs px-2 py-1 uppercase tracking-wider ${
              filter === f
                ? "bg-accent/20 text-text-accent border border-accent/40"
                : "bg-surface-hover text-text-secondary border border-border"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Sortable header */}
      <div className={`grid ${GRID_COLS} gap-2 px-4 py-2 text-[10px] uppercase tracking-wider text-text-tertiary border-b border-border bg-background`}>
        <span>System</span>
        <button
          onClick={() => toggleSort("hops")}
          className="text-left hover:text-text-primary"
        >
          Jumps
        </button>
        <button
          onClick={() => toggleSort("price")}
          className="text-left hover:text-text-primary"
        >
          Price
        </button>
        <button
          onClick={() => toggleSort("stock")}
          className="text-left hover:text-text-primary"
        >
          Stock
        </button>
        <span></span>
      </div>

      {/* Rows */}
      <div className="flex-1 overflow-y-auto">
        {rows.length === 0 && (
          <EmptyState message={`No visible systems carry ${goodName} matching this filter.`} />
        )}
        {rows.map((r) => {
          const color = priceRampColor(
            r.currentPrice,
            r.basePrice,
            filter === "sell" ? "sell" : "buy",
          );
          const isOrigin = r.systemId === fromSystemId;
          return (
            <div
              key={r.systemId}
              className={`grid ${GRID_COLS} gap-2 px-4 py-2 text-xs border-b border-border ${
                isOrigin ? "bg-surface-active" : "hover:bg-surface-hover"
              }`}
            >
              <span className="text-text-primary truncate">
                {r.name}{" "}
                {isOrigin && (
                  <span className="text-text-tertiary text-[10px]">(here)</span>
                )}
              </span>
              <span className="text-text-secondary font-mono">
                {r.hops != null ? r.hops : "—"}
              </span>
              <span
                style={{ color: color ?? undefined }}
                className="font-mono"
              >
                {formatCredits(r.currentPrice)}
              </span>
              <span className="text-text-secondary font-mono">{r.stock}</span>
              {!isOrigin && (
                <Button
                  onClick={() => onSelectSystem(r.systemId)}
                  variant="ghost"
                  size="xs"
                >
                  Go &rarr;
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
