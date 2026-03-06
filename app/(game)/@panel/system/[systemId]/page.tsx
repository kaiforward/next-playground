"use client";

import { use, useMemo } from "react";
import { useMarket } from "@/lib/hooks/use-market";
import { useEvents } from "@/lib/hooks/use-events";
import { useSystemInfo } from "@/lib/hooks/use-system-info";
import { useUniverse } from "@/lib/hooks/use-universe";
import { useSystemAllMissions } from "@/lib/hooks/use-op-missions";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { ActiveEventsSection } from "@/components/events/active-events-section";
import { TraitList } from "@/components/ui/trait-list";
import { EconomyBadge } from "@/components/ui/economy-badge";
import { ThemedPieChart } from "@/components/ui/themed-pie-chart";
import { Badge } from "@/components/ui/badge";
import { StatList, StatRow } from "@/components/ui/stat-row";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { SectionHeader } from "@/components/ui/section-header";
import { EmptyState } from "@/components/ui/empty-state";
import { getPriceTrendPct } from "@/lib/utils/market";
import { enrichTraits } from "@/lib/utils/traits";
import { formatCredits } from "@/lib/utils/format";
import { getPopulationLabel, getDangerInfo } from "@/lib/utils/system";
import { ECONOMY_PRODUCTION, ECONOMY_CONSUMPTION } from "@/lib/constants/universe";
import { GOODS } from "@/lib/constants/goods";
import { GOVERNMENT_TYPES } from "@/lib/constants/government";
import { getGoodColor } from "@/lib/constants/ui";
import { computeTraitDanger } from "@/lib/engine/trait-gen";
import type { GovernmentType } from "@/lib/types/game";

// ── Economy goods list ─────────────────────────────────────────

function GoodsList({ goods }: { goods: { name: string; rate: number }[] }) {
  if (goods.length === 0) {
    return <p className="text-sm text-text-tertiary">None</p>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {goods.map((g) => (
        <span
          key={g.name}
          className="inline-flex items-center gap-1 bg-surface px-2 py-0.5 text-sm text-text-primary"
        >
          {g.name}
          <span className="text-text-tertiary text-xs">({g.rate}/t)</span>
        </span>
      ))}
    </div>
  );
}

// ── Market price row ───────────────────────────────────────────

function PriceRow({ name, price, pct }: { name: string; price: number; pct: number }) {
  return (
    <li className="flex items-center justify-between py-1.5 px-3 bg-surface">
      <span className="text-sm text-text-primary">{name}</span>
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-text-primary">{formatCredits(price)}</span>
        <span
          className={`text-xs font-medium w-14 text-right ${
            pct > 0 ? "text-green-400" : pct < 0 ? "text-red-400" : "text-text-secondary"
          }`}
        >
          {pct > 0 ? "+" : ""}{pct.toFixed(0)}%
        </span>
      </div>
    </li>
  );
}

// ── Main content ───────────────────────────────────────────────

function SystemOverviewContent({ systemId }: { systemId: string }) {
  const { market } = useMarket(systemId);
  const { events } = useEvents();
  const { systemInfo, regionInfo } = useSystemInfo(systemId);
  const { data: universeData } = useUniverse();
  const allMissions = useSystemAllMissions(systemId);

  const traits = useMemo(
    () => enrichTraits(systemInfo?.traits ?? []),
    [systemInfo?.traits],
  );

  const systemEvents = useMemo(
    () => events.filter((e) => e.systemId === systemId),
    [events, systemId],
  );

  // Connections
  const connectionCount = useMemo(() => {
    if (!universeData) return 0;
    return universeData.connections.filter(
      (c) => c.fromSystemId === systemId || c.toSystemId === systemId,
    ).length;
  }, [universeData, systemId]);

  // Economy info
  const economyType = systemInfo?.economyType ?? "extraction";
  const producedGoods = useMemo(() => {
    const rates = ECONOMY_PRODUCTION[economyType] ?? {};
    return Object.entries(rates)
      .map(([goodId, rate]) => ({ name: GOODS[goodId]?.name ?? goodId, rate }))
      .sort((a, b) => b.rate - a.rate);
  }, [economyType]);

  const consumedGoods = useMemo(() => {
    const rates = ECONOMY_CONSUMPTION[economyType] ?? {};
    return Object.entries(rates)
      .map(([goodId, rate]) => ({ name: GOODS[goodId]?.name ?? goodId, rate }))
      .sort((a, b) => b.rate - a.rate);
  }, [economyType]);

  // Market snapshot — best premiums and biggest discounts
  const { bestPrices, cheapestSorted } = useMemo(() => {
    const withPct = market.map((e) => ({
      ...e,
      pct: getPriceTrendPct(e.currentPrice, e.basePrice),
    }));
    const sorted = [...withPct].sort((a, b) => b.pct - a.pct);
    return {
      bestPrices: sorted.slice(0, 5),
      cheapestSorted: sorted.slice(-5).reverse(),
    };
  }, [market]);

  // Supply distribution pie data — ThemedPieChart handles "Other" grouping
  const supplyData = useMemo(() => {
    const totalSupply = market.reduce((sum, e) => sum + e.supply, 0);
    if (totalSupply === 0) return [];
    return market.map((e) => ({
      name: e.goodName,
      value: e.supply,
      fill: getGoodColor(e.goodName),
    }));
  }, [market]);

  // Danger
  const govType: GovernmentType = regionInfo?.governmentType ?? "frontier";
  const govDef = GOVERNMENT_TYPES[govType];
  const traitDanger = computeTraitDanger(
    (systemInfo?.traits ?? []).map((t) => ({ traitId: t.traitId, quality: t.quality })),
  );
  const totalDanger = traitDanger + govDef.dangerBaseline;
  const danger = getDangerInfo(totalDanger);

  // Population
  const populationLabel = getPopulationLabel(economyType, traits.length);

  // Mission counts
  const tradeAvailable = allMissions.tradeMissions.available.length;
  const opAvailable = allMissions.opMissions.available.length;

  return (
    <>
      {/* Events banner */}
      {systemEvents.length > 0 && (
        <Card variant="bordered" padding="md" className="mb-6">
          <CardContent>
            <ActiveEventsSection events={systemEvents} />
          </CardContent>
        </Card>
      )}

      {/* System Summary — full width, two internal columns */}
      <Card variant="bordered" padding="md" className="mb-6">
        <CardHeader title="System Summary" />
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Left column — system stats */}
            <StatList>
              <StatRow label="Region">
                <span className="text-sm text-text-primary">{regionInfo?.name ?? "—"}</span>
              </StatRow>
              <StatRow label="Economy">
                <EconomyBadge economyType={economyType} />
              </StatRow>
              <StatRow label="Government">
                <span className="text-sm text-white capitalize">{govDef.name}</span>
              </StatRow>
              <StatRow label="Population">
                <span className="text-sm text-text-primary">{populationLabel}</span>
              </StatRow>
              <StatRow label="Traits">
                <span className="text-sm text-text-primary">{traits.length}</span>
              </StatRow>
              <StatRow label="Connections">
                <span className="text-sm text-text-primary">{connectionCount}</span>
              </StatRow>
              <StatRow label="Danger">
                <Badge color={danger.color}>{danger.label}</Badge>
              </StatRow>
              {systemInfo?.isGateway && (
                <StatRow label="Gateway">
                  <Badge color="amber">Yes</Badge>
                </StatRow>
              )}
            </StatList>

            {/* Right column — economy + missions */}
            <div className="space-y-4">
              <div>
                <SectionHeader as="h4" className="mb-2">Produces</SectionHeader>
                <GoodsList goods={producedGoods} />
              </div>
              <div>
                <SectionHeader as="h4" className="mb-2">Consumes</SectionHeader>
                <GoodsList goods={consumedGoods} />
              </div>
              <div className="border-t border-border pt-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-text-tertiary">Trade contracts</span>
                  <span className="text-sm text-text-accent">{tradeAvailable} avail</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-text-tertiary">Operations</span>
                  <span className="text-sm text-text-accent">{opAvailable} avail</span>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Market row — snapshot + pie chart */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Market Snapshot */}
        <Card variant="bordered" padding="md">
          <CardHeader title="Market Snapshot" />
          <CardContent>
            {market.length === 0 ? (
              <EmptyState message="No market data." />
            ) : (
              <div className="space-y-4">
                <div>
                  <SectionHeader as="h4" color="green" className="mb-2">Best Prices</SectionHeader>
                  <ul className="space-y-1.5">
                    {bestPrices.map((e) => (
                      <PriceRow
                        key={e.goodId}
                        name={e.goodName}
                        price={e.currentPrice}
                        pct={e.pct}
                      />
                    ))}
                  </ul>
                </div>
                <div>
                  <SectionHeader as="h4" color="red" className="mb-2">Cheapest</SectionHeader>
                  <ul className="space-y-1.5">
                    {cheapestSorted.map((e) => (
                      <PriceRow
                        key={e.goodId}
                        name={e.goodName}
                        price={e.currentPrice}
                        pct={e.pct}
                      />
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Supply Distribution */}
        <Card variant="bordered" padding="md" className="flex flex-col">
          <CardHeader title="Supply Distribution" />
          <CardContent className="flex-1 min-h-0">
            {supplyData.length === 0 ? (
              <EmptyState message="No market data." />
            ) : (
              <ThemedPieChart
                data={supplyData}
                otherThreshold={0.05}
                formatter={(value) => [`${value ?? 0} units`, "Supply"]}
              />
            )}
          </CardContent>
        </Card>
      </div>

      {/* System Traits — full width */}
      {traits.length > 0 && (
        <Card variant="bordered" padding="md">
          <CardHeader
            title="System Traits"
            subtitle={`${traits.length} trait${traits.length !== 1 ? "s" : ""}`}
          />
          <CardContent>
            <TraitList traits={traits} variant="full" />
          </CardContent>
        </Card>
      )}
    </>
  );
}

export default function SystemOverviewPage({
  params,
}: {
  params: Promise<{ systemId: string }>;
}) {
  const { systemId } = use(params);

  return (
    <QueryBoundary>
      <SystemOverviewContent systemId={systemId} />
    </QueryBoundary>
  );
}
