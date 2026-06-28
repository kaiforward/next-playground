"use client";

import { useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import { ChartTooltip } from "@/components/ui/chart-tooltip";
import { CHART_THEME } from "@/lib/constants/ui";
import type { TradeFlowVolumeBucket } from "@/lib/types/api";

// Direction colours match the diverging bars: imports red (in), exports green (out).
const IMPORT_COLOR = "#ef4444";
const EXPORT_COLOR = "#22c55e";

/** Bucketed import vs export volume over the flow-history window. */
export function VolumeSparkline({ buckets }: { buckets: TradeFlowVolumeBucket[] }) {
  const data = useMemo(
    () =>
      buckets.map((b) => ({
        tick: b.tick,
        imports: b.importVolume,
        exports: b.exportVolume,
      })),
    [buckets],
  );

  return (
    <div className="w-full h-32">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.gridStroke} />
          <XAxis
            dataKey="tick"
            stroke={CHART_THEME.axisStroke}
            tick={{ fill: CHART_THEME.tickFill, fontSize: CHART_THEME.tickFontSize }}
            tickFormatter={(v: number) => `t${v}`}
            minTickGap={32}
          />
          <YAxis
            stroke={CHART_THEME.axisStroke}
            tick={{ fill: CHART_THEME.tickFill, fontSize: CHART_THEME.tickFontSize }}
            width={28}
          />
          <ChartTooltip
            labelFormatter={(label) => `Tick ${label}`}
            formatter={(value, name) => [
              `${value ?? 0} units`,
              name === "imports" ? "Imports" : "Exports",
            ]}
          />
          <Line type="monotone" dataKey="imports" stroke={IMPORT_COLOR} strokeWidth={2} dot={false} activeDot={{ r: 4, fill: IMPORT_COLOR }} />
          <Line type="monotone" dataKey="exports" stroke={EXPORT_COLOR} strokeWidth={2} dot={false} activeDot={{ r: 4, fill: EXPORT_COLOR }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
