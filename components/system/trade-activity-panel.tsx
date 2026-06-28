"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/ui/section-header";
import { getGoodColor } from "@/lib/constants/ui";
import { useSystemTradeFlow } from "@/lib/hooks/use-system-trade-flow";
import type { TradeFlowGoodSummary } from "@/lib/types/api";
import { VolumeSparkline } from "@/components/system/volume-sparkline";

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

