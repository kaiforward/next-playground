"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";
import { ChartTooltip } from "@/components/ui/chart-tooltip";
import { CHART_THEME } from "@/lib/constants/ui";
import { Card, CardHeader, CardContent } from "@/components/ui/card";

interface PriceChartProps {
  data: { time: string; price: number }[];
  goodName: string;
  cargoQuantity?: number;
}

export function PriceChart({ data, goodName, cargoQuantity }: PriceChartProps) {
  const subtitle = cargoQuantity
    ? `You own ${cargoQuantity} unit${cargoQuantity === 1 ? "" : "s"}`
    : "You own none";

  return (
    <Card variant="bordered" padding="md">
      <CardHeader
        title={`${goodName} Price History`}
        subtitle={subtitle}
      />
      <CardContent>
        <div className="w-full h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={data}
              margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.gridStroke} />
              <XAxis
                dataKey="time"
                stroke={CHART_THEME.axisStroke}
                tick={{ fill: CHART_THEME.tickFill, fontSize: CHART_THEME.tickFontSize }}
              />
              <YAxis
                stroke={CHART_THEME.axisStroke}
                tick={{ fill: CHART_THEME.tickFill, fontSize: CHART_THEME.tickFontSize }}
                tickFormatter={(v: number) => `${v} CR`}
              />
              <ChartTooltip
                formatter={(value) => [`${value ?? 0} CR`, "Price"]}
              />
              <Line
                type="monotone"
                dataKey="price"
                stroke="#60a5fa"
                strokeWidth={2}
                dot={{ fill: "#60a5fa", strokeWidth: 0, r: 4 }}
                activeDot={{ r: 6, fill: "#93c5fd" }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
