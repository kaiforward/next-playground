"use client";

import { Tooltip } from "recharts";
import type { ComponentProps } from "react";
import { CHART_THEME } from "@/lib/constants/ui";

type ChartTooltipProps = ComponentProps<typeof Tooltip>;

export function ChartTooltip(props: ChartTooltipProps) {
  return (
    <Tooltip
      contentStyle={{
        backgroundColor: CHART_THEME.tooltipBg,
        border: `1px solid ${CHART_THEME.tooltipBorder}`,
        borderRadius: CHART_THEME.tooltipBorderRadius,
        color: CHART_THEME.tooltipTextColor,
      }}
      labelStyle={{ color: CHART_THEME.tooltipLabelColor }}
      itemStyle={{ color: CHART_THEME.tooltipTextColor }}
      {...props}
    />
  );
}
