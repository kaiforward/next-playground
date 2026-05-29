"use client";

import type { MarketEntry } from "@/lib/types/game";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { ThemedBarChart } from "@/components/ui/themed-bar-chart";

const BARS = [{ dataKey: "stock", name: "In Stock", color: "#60a5fa" }];

interface StockChartProps {
  entries: MarketEntry[];
}

export function StockChart({ entries }: StockChartProps) {
  const data = entries.map((e) => ({ name: e.goodName, stock: e.stock }));

  return (
    <Card variant="bordered" padding="md">
      <CardHeader title="Stock Levels" subtitle="Inventory for all goods" />
      <CardContent>
        <div className="w-full h-72">
          <ThemedBarChart data={data} bars={BARS} xAxisKey="name" />
        </div>
      </CardContent>
    </Card>
  );
}
