"use client";

import { Tooltip } from "recharts";
import type { ComponentProps } from "react";

type ChartTooltipProps = ComponentProps<typeof Tooltip>;

export function ChartTooltip(props: ChartTooltipProps) {
  return (
    <Tooltip
      contentStyle={{
        backgroundColor: "#1a1a2e",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: "8px",
        color: "#fff",
      }}
      labelStyle={{ color: "#999" }}
      itemStyle={{ color: "#fff" }}
      {...props}
    />
  );
}
