"use client";

import { useMemo } from "react";
import { PieChart, Pie, ResponsiveContainer } from "recharts";
import { ChartTooltip } from "@/components/ui/chart-tooltip";
import type { ComponentProps } from "react";

type TooltipFormatter = ComponentProps<typeof ChartTooltip>["formatter"];

export interface PieSlice {
  name: string;
  value: number;
  fill: string;
}

interface ThemedPieChartProps {
  data: PieSlice[];
  otherThreshold?: number;
  otherColor?: string;
  minHeight?: number;
  formatter?: TooltipFormatter;
}

const RADIAN = Math.PI / 180;

function renderPieLabel(props: {
  cx?: number;
  cy?: number;
  midAngle?: number;
  outerRadius?: number;
  name?: string;
  percent?: number;
}) {
  const { cx = 0, cy = 0, midAngle = 0, outerRadius = 0, name = "", percent = 0 } = props;

  if (percent < 0.04) return null;

  const radius = outerRadius + 18;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);

  return (
    <text
      x={x}
      y={y}
      fill="#fff"
      textAnchor={x > cx ? "start" : "end"}
      dominantBaseline="central"
      fontSize={11}
    >
      {name}
    </text>
  );
}

export function ThemedPieChart({
  data,
  otherThreshold = 0,
  otherColor = "#6b7280",
  minHeight = 280,
  formatter,
}: ThemedPieChartProps) {
  const chartData = useMemo(() => {
    if (otherThreshold <= 0) return data;

    const total = data.reduce((sum, d) => sum + d.value, 0);
    if (total === 0) return data;

    let otherValue = 0;
    const slices: PieSlice[] = [];

    for (const d of [...data].sort((a, b) => b.value - a.value)) {
      if (d.value / total < otherThreshold) {
        otherValue += d.value;
      } else {
        slices.push(d);
      }
    }

    if (otherValue > 0) {
      slices.push({ name: "Other", value: otherValue, fill: otherColor });
    }

    return slices;
  }, [data, otherThreshold, otherColor]);

  return (
    <ResponsiveContainer width="100%" height="100%" minHeight={minHeight}>
      <PieChart>
        <Pie
          data={chartData}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          outerRadius="70%"
          strokeWidth={1}
          stroke="rgba(255,255,255,0.1)"
          isAnimationActive={false}
          label={renderPieLabel}
        />
        <ChartTooltip formatter={formatter} />
      </PieChart>
    </ResponsiveContainer>
  );
}
