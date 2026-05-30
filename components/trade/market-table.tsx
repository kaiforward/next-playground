"use client";

import type { MarketEntry } from "@/lib/types/game";
import { getPriceTrendPct } from "@/lib/utils/market";
import { priceRampColor } from "@/lib/utils/price-ramp";
import { formatCredits } from "@/lib/utils/format";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { TrendIcon } from "@/components/ui/trend-icon";

interface MarketTableProps {
  entries: MarketEntry[];
  onSelectGood: (goodId: string) => void;
  selectedGoodId?: string;
  /** Quantity of each good the player currently owns, keyed by goodId. */
  cargoByGoodId?: Map<string, number>;
  /** When provided, renders a per-row Compare action that opens a cross-system comparison. */
  onCompareGood?: (goodId: string, goodName: string) => void;
}

export function MarketTable({
  entries,
  onSelectGood,
  selectedGoodId,
  cargoByGoodId,
  onCompareGood,
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
            render: (row: MarketEntry) => {
              const qty = cargoByGoodId.get(row.goodId) ?? 0;
              return qty > 0
                ? <span className="text-text-primary font-medium">{qty}</span>
                : <span className="text-text-tertiary">0</span>;
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
      key: "stock",
      label: "In Stock",
      sortable: true,
      getValue: (row) => row.stock,
      render: (row) => <span className="font-mono">{row.stock}</span>,
    },
    {
      key: "buyPrice",
      label: "Buy",
      sortable: true,
      getValue: (row) => row.buyPrice,
      render: (row) => <span className="font-mono text-text-secondary">{formatCredits(row.buyPrice)}</span>,
    },
    {
      key: "sellPrice",
      label: "Sell",
      sortable: true,
      getValue: (row) => row.sellPrice,
      render: (row) => <span className="font-mono text-text-secondary">{formatCredits(row.sellPrice)}</span>,
    },
    {
      key: "priceTrend",
      label: "Trend",
      sortable: true,
      getValue: (row) => getPriceTrendPct(row.currentPrice, row.basePrice),
      render: (row) => {
        const diff = row.currentPrice - row.basePrice;
        if (diff === 0) return <span className="text-text-secondary">--</span>;
        const pct = getPriceTrendPct(row.currentPrice, row.basePrice).toFixed(1);
        // Value convention (default buy perspective): above base = premium (red),
        // below = bargain (green). Arrow still shows direction.
        const color = priceRampColor(row.currentPrice, row.basePrice) ?? undefined;
        return (
          <span style={{ color }} className="font-medium">
            <TrendIcon direction={diff > 0 ? "up" : "down"} className="mr-1" />
            {diff > 0 ? "+" : ""}{pct}%
          </span>
        );
      },
    },
    ...(onCompareGood
      ? [
          {
            key: "compare",
            label: "",
            render: (row: MarketEntry) => (
              <Button
                onClick={(e) => {
                  e.stopPropagation();
                  onCompareGood(row.goodId, row.goodName);
                }}
                variant="pill"
                color="accent"
                size="xs"
                aria-label={`Compare ${row.goodName} across systems`}
              >
                Compare
              </Button>
            ),
          },
        ]
      : []),
  ];

  return (
    <DataTable
      columns={columns}
      data={entries}
      getKey={(row) => row.goodId}
      onRowClick={(row) => onSelectGood(row.goodId)}
      rowClassName={(row) =>
        row.goodId === selectedGoodId ? "bg-surface-active" : ""
      }
    />
  );
}
