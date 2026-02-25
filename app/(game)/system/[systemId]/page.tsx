"use client";

import { use, useMemo } from "react";
import { useMarket } from "@/lib/hooks/use-market";
import { useEvents } from "@/lib/hooks/use-events";
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
import { getPriceTrendPct } from "@/lib/utils/market";
import { enrichTraits } from "@/lib/utils/traits";
import { formatCredits } from "@/lib/utils/format";
import { ECONOMY_PRODUCTION, ECONOMY_CONSUMPTION } from "@/lib/constants/universe";
import { GOODS } from "@/lib/constants/goods";
import { GOVERNMENT_TYPES } from "@/lib/constants/government";
import { computeTraitDanger } from "@/lib/engine/trait-gen";
import type { EconomyType, GovernmentType } from "@/lib/types/game";

// ── Population derivation ──────────────────────────────────────

const ECONOMY_POP_BASE: Record<EconomyType, number> = {
  core: 3, industrial: 2, tech: 2, refinery: 1, agricultural: 1, extraction: 0,
};
const POP_LABELS = ["Outpost", "Sparse", "Moderate", "Populated", "Dense"] as const;

function getPopulationLabel(economyType: EconomyType, traitCount: number): string {
  let tier = ECONOMY_POP_BASE[economyType];
  if (traitCount >= 3) tier += 1;
  return POP_LABELS[Math.min(Math.max(tier, 0), 4)];
}

// ── Danger bucketing ───────────────────────────────────────────

function getDangerInfo(rawDanger: number): { label: string; color: "green" | "amber" | "red" } {
  if (rawDanger <= 0) return { label: "None", color: "green" };
  if (rawDanger < 0.1) return { label: "Low", color: "green" };
  if (rawDanger < 0.2) return { label: "Moderate", color: "amber" };
  if (rawDanger < 0.35) return { label: "High", color: "red" };
  return { label: "Extreme", color: "red" };
}

// ── Economy goods list ─────────────────────────────────────────

function GoodsList({ goods }: { goods: { name: string; rate: number }[] }) {
  if (goods.length === 0) {
    return <p className="text-sm text-white/30">None</p>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {goods.map((g) => (
        <span
          key={g.name}
          className="inline-flex items-center gap-1 rounded bg-white/5 px-2 py-0.5 text-sm text-white/80"
        >
          {g.name}
          <span className="text-white/30 text-xs">({g.rate}/t)</span>
        </span>
      ))}
    </div>
  );
}

// ── Market price row ───────────────────────────────────────────

function PriceRow({ name, price, pct }: { name: string; price: number; pct: number }) {
  return (
    <li className="flex items-center justify-between py-1.5 px-3 rounded-lg bg-white/5">
      <span className="text-sm text-white">{name}</span>
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-white">{formatCredits(price)}</span>
        <span
          className={`text-xs font-medium w-14 text-right ${
            pct > 0 ? "text-green-400" : pct < 0 ? "text-red-400" : "text-white/40"
          }`}
        >
          {pct > 0 ? "+" : ""}{pct.toFixed(0)}%
        </span>
      </div>
    </li>
  );
}

// ── Pie chart colors (keyed by good slug from GOODS constant) ──

const GOOD_COLORS: Record<string, string> = {
  water: "#60a5fa",
  food: "#4ade80",
  ore: "#d97706",
  textiles: "#c084fc",
  fuel: "#f97316",
  metals: "#94a3b8",
  chemicals: "#22d3ee",
  medicine: "#f472b6",
  electronics: "#818cf8",
  machinery: "#a8a29e",
  weapons: "#ef4444",
  luxuries: "#fbbf24",
};

/** Reverse map: display name → slug key (e.g. "Water" → "water"). */
const GOOD_NAME_TO_SLUG: Record<string, string> = Object.fromEntries(
  Object.entries(GOODS).map(([slug, def]) => [def.name, slug]),
);

function getGoodColor(goodName: string): string {
  const slug = GOOD_NAME_TO_SLUG[goodName];
  return slug ? (GOOD_COLORS[slug] ?? "#6b7280") : "#6b7280";
}

// ── Main content ───────────────────────────────────────────────

function SystemOverviewContent({ systemId }: { systemId: string }) {
  const { market } = useMarket(systemId);
  const { events } = useEvents();
  const { data: universeData } = useUniverse();
  const allMissions = useSystemAllMissions(systemId);

  const systemInfo = universeData?.systems.find((s) => s.id === systemId);
  const regionInfo = systemInfo
    ? universeData?.regions.find((r) => r.id === systemInfo.regionId)
    : undefined;

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
                <span className="text-sm text-white">{regionInfo?.name ?? "—"}</span>
              </StatRow>
              <StatRow label="Economy">
                <EconomyBadge economyType={economyType} />
              </StatRow>
              <StatRow label="Government">
                <span className="text-sm text-white capitalize">{govDef.name}</span>
              </StatRow>
              <StatRow label="Population">
                <span className="text-sm text-white">{populationLabel}</span>
              </StatRow>
              <StatRow label="Traits">
                <span className="text-sm text-white">{traits.length}</span>
              </StatRow>
              <StatRow label="Connections">
                <span className="text-sm text-white">{connectionCount}</span>
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
                <h4 className="text-xs font-semibold uppercase tracking-wider text-white/40 mb-2">
                  Produces
                </h4>
                <GoodsList goods={producedGoods} />
              </div>
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-white/40 mb-2">
                  Consumes
                </h4>
                <GoodsList goods={consumedGoods} />
              </div>
              <div className="border-t border-white/10 pt-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-white/50">Trade contracts</span>
                  <span className="text-sm text-indigo-400">{tradeAvailable} avail</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-white/50">Operations</span>
                  <span className="text-sm text-indigo-400">{opAvailable} avail</span>
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
              <p className="text-sm text-white/30 py-4 text-center">No market data.</p>
            ) : (
              <div className="space-y-4">
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-green-400/70 mb-2">
                    Best Prices
                  </h4>
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
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-red-400/70 mb-2">
                    Cheapest
                  </h4>
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
              <p className="text-sm text-white/30 py-4 text-center">No market data.</p>
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
