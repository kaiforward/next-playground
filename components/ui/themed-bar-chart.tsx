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
import { CHART_THEME } from "@/lib/constants/ui";
import type { ComponentProps } from "react";

type TooltipFormatter = ComponentProps<typeof ChartTooltip>["formatter"];

interface BarDef {
  dataKey: string;
  name: string;
  color: string;
}

interface ThemedBarChartProps<T extends Record<string, string | number>> {
  data: T[];
  bars: BarDef[];
  xAxisKey: keyof T & string;
  showLegend?: boolean;
  minHeight?: number;
  formatter?: TooltipFormatter;
  yAxisFormatter?: (v: number) => string;
}

export function ThemedBarChart<T extends Record<string, string | number>>({
  data,
  bars,
  xAxisKey,
  showLegend = true,
  minHeight = 288,
  formatter,
  yAxisFormatter,
}: ThemedBarChartProps<T>) {
  return (
    <ResponsiveContainer width="100%" height="100%" minHeight={minHeight}>
      <BarChart
        data={data}
        margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.gridStroke} />
        <XAxis
          dataKey={xAxisKey}
          stroke={CHART_THEME.axisStroke}
          tick={{ fill: CHART_THEME.tickFill, fontSize: CHART_THEME.tickFontSize }}
        />
        <YAxis
          stroke={CHART_THEME.axisStroke}
          tick={{ fill: CHART_THEME.tickFill, fontSize: CHART_THEME.tickFontSize }}
          tickFormatter={yAxisFormatter}
        />
        <ChartTooltip formatter={formatter} />
        {showLegend && (
          <Legend wrapperStyle={{ color: CHART_THEME.legendColor, paddingTop: "10px" }} />
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
