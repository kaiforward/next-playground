"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { ChartTooltip } from "@/components/ui/chart-tooltip";
import type { ComponentProps } from "react";

type TooltipFormatter = ComponentProps<typeof ChartTooltip>["formatter"];

interface BarDef {
  dataKey: string;
  name: string;
  color: string;
}

interface ThemedBarChartProps {
  data: Record<string, string | number>[];
  bars: BarDef[];
  xAxisKey: string;
  showLegend?: boolean;
  minHeight?: number;
  formatter?: TooltipFormatter;
  yAxisFormatter?: (v: number) => string;
}

export function ThemedBarChart({
  data,
  bars,
  xAxisKey,
  showLegend = true,
  minHeight = 288,
  formatter,
  yAxisFormatter,
}: ThemedBarChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%" minHeight={minHeight}>
      <BarChart
        data={data}
        margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#333" />
        <XAxis
          dataKey={xAxisKey}
          stroke="#666"
          tick={{ fill: "#999", fontSize: 12 }}
        />
        <YAxis
          stroke="#666"
          tick={{ fill: "#999", fontSize: 12 }}
          tickFormatter={yAxisFormatter}
        />
        <ChartTooltip formatter={formatter} />
        {showLegend && (
          <Legend wrapperStyle={{ color: "#999", paddingTop: "10px" }} />
        )}
        {bars.map((bar) => (
          <Bar
            key={bar.dataKey}
            dataKey={bar.dataKey}
            name={bar.name}
            fill={bar.color}
            radius={[4, 4, 0, 0]}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
