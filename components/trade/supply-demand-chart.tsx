"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import type { MarketEntry } from "@/lib/types/game";
import { Card, CardHeader, CardContent } from "@/components/ui/card";

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
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data}
              margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#333" />
              <XAxis
                dataKey="name"
                stroke="#666"
                tick={{ fill: "#999", fontSize: 12 }}
              />
              <YAxis
                stroke="#666"
                tick={{ fill: "#999", fontSize: 12 }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#1a1a2e",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: "8px",
                  color: "#fff",
                }}
                labelStyle={{ color: "#999" }}
              />
              <Legend
                wrapperStyle={{ color: "#999", paddingTop: "10px" }}
              />
              <Bar
                dataKey="supply"
                name="Supply"
                fill="#60a5fa"
                radius={[4, 4, 0, 0]}
              />
              <Bar
                dataKey="demand"
                name="Demand"
                fill="#f59e0b"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
