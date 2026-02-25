"use client";

import type { MarketEntry } from "@/lib/types/game";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { ThemedBarChart } from "@/components/ui/themed-bar-chart";

const BARS = [
  { dataKey: "supply", name: "Supply", color: "#60a5fa" },
  { dataKey: "demand", name: "Demand", color: "#f59e0b" },
];

interface SupplyDemandChartProps {
  entries: MarketEntry[];
}

export function SupplyDemandChart({ entries }: SupplyDemandChartProps) {
  const data = entries.map((e) => ({
    name: e.goodName,
    supply: e.supply,
    demand: e.demand,
  }));

  return (
    <Card variant="bordered" padding="md">
      <CardHeader
        title="Supply & Demand"
        subtitle="Market overview for all goods"
      />
      <CardContent>
        <div className="w-full h-72">
          <ThemedBarChart data={data} bars={BARS} xAxisKey="name" />
        </div>
      </CardContent>
    </Card>
  );
}
