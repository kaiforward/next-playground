"use client";

import type { MarketEntry } from "@/lib/types/game";
import { getPriceTrendPct } from "@/lib/utils/market";
import { formatCredits } from "@/lib/utils/format";
import { DataTable, type Column } from "@/components/ui/data-table";
import { TrendIcon } from "@/components/ui/trend-icon";

interface MarketTableProps {
  entries: MarketEntry[];
  onSelectGood: (goodId: string) => void;
  selectedGoodId?: string;
  /** Quantity of each good the player currently owns, keyed by goodId. */
  cargoByGoodId?: Map<string, number>;
}

export function MarketTable({
  entries,
  onSelectGood,
  selectedGoodId,
  cargoByGoodId,
}: MarketTableProps) {
  const columns: Column<MarketEntry>[] = [
    {
      key: "goodName",
      label: "Good",
      sortable: true,
      getValue: (row) => row.goodName,
      render: (row) => (
        <span className="font-medium text-text-primary">{row.goodName}</span>
      ),
    },
    ...(cargoByGoodId
      ? [
          {
            key: "owned",
            label: "Owned",
            sortable: false,
            render: (row: MarketEntry) => {
              const qty = cargoByGoodId.get(row.goodId) ?? 0;
              return qty > 0
                ? <span className="text-text-primary font-medium">{qty}</span>
                : <span className="text-text-faint">0</span>;
            },
          },
        ]
      : []),
    {
      key: "basePrice",
      label: "Base Price",
      sortable: true,
      getValue: (row) => row.basePrice,
      render: (row) => (
        <span className="text-text-secondary">{formatCredits(row.basePrice)}</span>
      ),
    },
    {
      key: "currentPrice",
      label: "Current Price",
      sortable: true,
      getValue: (row) => row.currentPrice,
      render: (row) => (
        <span className="font-semibold text-text-primary">
          {formatCredits(row.currentPrice)}
        </span>
      ),
    },
    {
      key: "supply",
      label: "Supply",
      sortable: true,
      getValue: (row) => row.supply,
      render: (row) => <>{row.supply}</>,
    },
    {
      key: "demand",
      label: "Demand",
      sortable: true,
      getValue: (row) => row.demand,
      render: (row) => <>{row.demand}</>,
    },
    {
      key: "priceTrend",
      label: "Trend",
      sortable: false,
      render: (row) => {
        const diff = row.currentPrice - row.basePrice;
        const pct = getPriceTrendPct(row.currentPrice, row.basePrice).toFixed(1);
        if (diff > 0) {
          return (
            <span className="text-green-400 font-medium">
              <TrendIcon direction="up" className="mr-1" />
              +{pct}%
            </span>
          );
        }
        if (diff < 0) {
          return (
            <span className="text-red-400 font-medium">
              <TrendIcon direction="down" className="mr-1" />
              {pct}%
            </span>
          );
        }
        return <span className="text-text-muted">--</span>;
      },
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={entries}
      onRowClick={(row) => onSelectGood(row.goodId)}
      rowClassName={(row) =>
        row.goodId === selectedGoodId ? "bg-surface-active" : ""
      }
    />
  );
}
