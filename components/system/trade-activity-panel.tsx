"use client";

import Link from "next/link";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ChartTooltip } from "@/components/ui/chart-tooltip";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/ui/section-header";
import { TIER_COLOR, pixiHexToCss } from "@/lib/constants/good-colors";
import { CHART_THEME, getGoodColor } from "@/lib/constants/ui";
import { useSystemTradeFlow } from "@/lib/hooks/use-system-trade-flow";

const SPARKLINE_IMPORT_COLOR = pixiHexToCss(TIER_COLOR[0]);
const SPARKLINE_EXPORT_COLOR = pixiHexToCss(TIER_COLOR[1]);
import type {
  TradeFlowGoodSummary,
  TradeFlowVolumeBucket,
} from "@/lib/types/api";

interface TradeActivityPanelProps {
  systemId: string;
}

/**
 * "Trade Activity" section on the system overview panel. Surfaces the
 * top imported / exported goods (with the top partner systems contributing
 * to each) and a sparkline of bucketed import vs export volume over the
 * flow-history window. Data comes from `useSystemTradeFlow`, which is
 * visibility-gated server-side.
 */
export function TradeActivityPanel({ systemId }: TradeActivityPanelProps) {
  const { topImports, topExports, volumeHistory } =
    useSystemTradeFlow(systemId);

  const hasActivity = topImports.length > 0 || topExports.length > 0;

  return (
    <Card variant="bordered" padding="md" className="mb-6">
      <CardHeader
        title="Trade Activity"
        subtitle="Inter-system flow over the recent window"
      />
      <CardContent>
        {!hasActivity ? (
          <EmptyState message="No recent trade activity." />
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <GoodFlowList
                heading="Top Imports"
                color="green"
                goods={topImports}
                partnerLabel="Sources"
              />
              <GoodFlowList
                heading="Top Exports"
                color="default"
                goods={topExports}
                partnerLabel="Destinations"
              />
            </div>
            <div className="mt-6 border-t border-border pt-4">
              <SectionHeader as="h4" className="mb-2">
                Volume History
              </SectionHeader>
              <VolumeSparkline buckets={volumeHistory} />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── Good-flow list ────────────────────────────────────────────────

interface GoodFlowListProps {
  heading: string;
  color: "green" | "default";
  goods: TradeFlowGoodSummary[];
  partnerLabel: string;
}

function GoodFlowList({
  heading,
  color,
  goods,
  partnerLabel,
}: GoodFlowListProps) {
  return (
    <div>
      <SectionHeader as="h4" color={color} className="mb-2">
        {heading}
      </SectionHeader>
      {goods.length === 0 ? (
        <p className="text-sm text-text-tertiary">None recorded.</p>
      ) : (
        <dl className="space-y-3">
          {goods.map((good) => (
            <GoodFlowRow
              key={good.goodId}
              good={good}
              partnerLabel={partnerLabel}
            />
          ))}
        </dl>
      )}
    </div>
  );
}

function GoodFlowRow({
  good,
  partnerLabel,
}: {
  good: TradeFlowGoodSummary;
  partnerLabel: string;
}) {
  return (
    <div className="bg-surface px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <dt className="flex items-center gap-2 min-w-0">
          <span
            className="h-2 w-2 shrink-0"
            style={{ backgroundColor: getGoodColor(good.goodName) }}
            aria-hidden
          />
          <span className="text-sm text-text-primary truncate">
            {good.goodName}
          </span>
        </dt>
        <dd className="font-mono text-sm text-text-accent shrink-0">
          {good.totalQuantity.toLocaleString()}
        </dd>
      </div>
      {good.partners.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {good.partners.map((p) => (
            <li
              key={p.systemId}
              className="flex items-center justify-between gap-3 pl-4 text-xs"
            >
              <Link
                href={`/system/${p.systemId}`}
                className="text-text-secondary hover:text-text-accent truncate"
                title={`${partnerLabel}: ${p.systemName}`}
              >
                {p.systemName}
              </Link>
              <span className="font-mono text-text-tertiary shrink-0">
                {p.quantity.toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Sparkline ─────────────────────────────────────────────────────

interface VolumeSparklineProps {
  buckets: TradeFlowVolumeBucket[];
}

function VolumeSparkline({ buckets }: VolumeSparklineProps) {
  // Compress to {tick, imports, exports} for the chart. Use the bucket's
  // right-edge tick directly so the tooltip can show absolute tick numbers
  // — the chart's job is the trend, not exact labels on the X axis.
  const data = buckets.map((b) => ({
    tick: b.tick,
    imports: b.importVolume,
    exports: b.exportVolume,
  }));

  return (
    <div className="w-full h-32">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          margin={{ top: 5, right: 10, left: 0, bottom: 0 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke={CHART_THEME.gridStroke}
          />
          <XAxis
            dataKey="tick"
            stroke={CHART_THEME.axisStroke}
            tick={{
              fill: CHART_THEME.tickFill,
              fontSize: CHART_THEME.tickFontSize,
            }}
            tickFormatter={(v: number) => `t${v}`}
            minTickGap={32}
          />
          <YAxis
            stroke={CHART_THEME.axisStroke}
            tick={{
              fill: CHART_THEME.tickFill,
              fontSize: CHART_THEME.tickFontSize,
            }}
            width={28}
          />
          <ChartTooltip
            labelFormatter={(label) => `Tick ${label}`}
            formatter={(value, name) => [
              `${value ?? 0} units`,
              name === "imports" ? "Imports" : "Exports",
            ]}
          />
          <Line
            type="monotone"
            dataKey="imports"
            stroke={SPARKLINE_IMPORT_COLOR}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: SPARKLINE_IMPORT_COLOR }}
          />
          <Line
            type="monotone"
            dataKey="exports"
            stroke={SPARKLINE_EXPORT_COLOR}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: SPARKLINE_EXPORT_COLOR }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
