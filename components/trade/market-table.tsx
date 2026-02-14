"use client";

import type { MarketEntry } from "@/lib/types/game";
import { getPriceTrendPct } from "@/lib/utils/market";
import { formatCredits } from "@/lib/utils/format";
import { DataTable, type Column } from "@/components/ui/data-table";

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
  const columns: Column<MarketEntry & Record<string, unknown>>[] = [
    {
      key: "goodName",
      label: "Good",
      sortable: true,
      render: (row) => (
        <span className="font-medium text-white">{row.goodName}</span>
      ),
    },
    ...(cargoByGoodId
      ? [
          {
            key: "owned" as const,
            label: "Owned",
            sortable: false,
            render: (row: MarketEntry & Record<string, unknown>) => {
              const qty = cargoByGoodId.get(row.goodId) ?? 0;
              return qty > 0
                ? <span className="text-white font-medium">{qty}</span>
                : <span className="text-white/30">0</span>;
            },
          },
        ]
      : []),
    {
      key: "basePrice",
      label: "Base Price",
      sortable: true,
      render: (row) => (
        <span className="text-white/60">{formatCredits(row.basePrice)}</span>
      ),
    },
    {
      key: "currentPrice",
      label: "Current Price",
      sortable: true,
      render: (row) => (
        <span className="font-semibold text-white">
          {formatCredits(row.currentPrice)}
        </span>
      ),
    },
    {
      key: "supply",
      label: "Supply",
      sortable: true,
    },
    {
      key: "demand",
      label: "Demand",
      sortable: true,
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
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="w-4 h-4 inline mr-1"
              >
                <path
                  fillRule="evenodd"
                  d="M10 17a.75.75 0 01-.75-.75V5.612L5.29 9.77a.75.75 0 01-1.08-1.04l5.25-5.5a.75.75 0 011.08 0l5.25 5.5a.75.75 0 11-1.08 1.04l-3.96-4.158V16.25A.75.75 0 0110 17z"
                  clipRule="evenodd"
                />
              </svg>
              +{pct}%
            </span>
          );
        }
        if (diff < 0) {
          return (
            <span className="text-red-400 font-medium">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="w-4 h-4 inline mr-1"
              >
                <path
                  fillRule="evenodd"
                  d="M10 3a.75.75 0 01.75.75v10.638l3.96-4.158a.75.75 0 111.08 1.04l-5.25 5.5a.75.75 0 01-1.08 0l-5.25-5.5a.75.75 0 111.08-1.04l3.96 4.158V3.75A.75.75 0 0110 3z"
                  clipRule="evenodd"
                />
              </svg>
              {pct}%
            </span>
          );
        }
        return <span className="text-white/40">--</span>;
      },
    },
  ];

  // Cast entries so they satisfy Record<string, unknown> for DataTable
  const data = entries as (MarketEntry & Record<string, unknown>)[];

  return (
    <DataTable
      columns={columns}
      data={data}
      onRowClick={(row) => onSelectGood(row.goodId)}
      rowClassName={(row) =>
        row.goodId === selectedGoodId ? "bg-white/10" : ""
      }
    />
  );
}
