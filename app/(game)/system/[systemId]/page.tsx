"use client";

import { use, useMemo } from "react";
import Link from "next/link";
import { useFleet } from "@/lib/hooks/use-fleet";
import { useMarket } from "@/lib/hooks/use-market";
import { useEvents } from "@/lib/hooks/use-events";
import { useUniverse } from "@/lib/hooks/use-universe";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { ActiveEventsSection } from "@/components/events/active-events-section";
import { TraitList } from "@/components/ui/trait-list";
import { Button } from "@/components/ui/button";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { getPriceTrendPct } from "@/lib/utils/market";
import { enrichTraits } from "@/lib/utils/traits";

function SystemOverviewContent({ systemId }: { systemId: string }) {
  const { fleet } = useFleet();
  const { market } = useMarket(systemId);
  const { events } = useEvents();
  const { data: universeData } = useUniverse();

  const systemInfo = universeData?.systems.find((s) => s.id === systemId);
  const traits = useMemo(
    () => enrichTraits(systemInfo?.traits ?? []),
    [systemInfo?.traits],
  );

  const systemEvents = useMemo(
    () => events.filter((e) => e.systemId === systemId),
    [events, systemId],
  );

  const topMarket = useMemo(
    () => [...market].sort((a, b) => b.currentPrice - a.currentPrice).slice(0, 6),
    [market],
  );

  const shipsHere = fleet.ships.filter(
    (s) => s.status === "docked" && s.systemId === systemId
  );

  return (
    <>
      {systemEvents.length > 0 && (
        <Card variant="bordered" padding="md" className="mb-6">
          <CardContent>
            <ActiveEventsSection events={systemEvents} />
          </CardContent>
        </Card>
      )}

      {traits.length > 0 && (
        <Card variant="bordered" padding="md" className="mb-6">
          <CardHeader
            title="System Traits"
            subtitle={`${traits.length} trait${traits.length !== 1 ? "s" : ""}`}
          />
          <CardContent>
            <TraitList traits={traits} variant="full" />
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Ships docked */}
        <Card variant="bordered" padding="md">
          <CardHeader title="Ships Docked" subtitle={`${shipsHere.length} ship${shipsHere.length !== 1 ? "s" : ""}`} />
          <CardContent>
            {shipsHere.length === 0 ? (
              <p className="text-sm text-white/30 py-4 text-center">
                No ships docked at this system.
              </p>
            ) : (
              <ul className="space-y-2">
                {shipsHere.map((ship) => (
                  <li
                    key={ship.id}
                    className="flex items-center justify-between py-2 px-3 rounded-lg bg-white/5"
                  >
                    <Link
                      href={`/ship/${ship.id}?from=system-${systemId}`}
                      className="text-sm font-medium text-white hover:text-blue-300 transition-colors"
                    >
                      {ship.name}
                    </Link>
                    <Button href={`/system/${systemId}/market?shipId=${ship.id}`} variant="pill" color="indigo" size="xs">
                      Trade
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Market summary */}
        <Card variant="bordered" padding="md">
          <CardHeader title="Market" subtitle="Top goods by price" />
          <CardContent>
            {market.length === 0 ? (
              <p className="text-sm text-white/30 py-4 text-center">No market data.</p>
            ) : (
              <ul className="space-y-2">
                {topMarket.map((entry) => {
                    const diff = entry.currentPrice - entry.basePrice;
                    const pct = getPriceTrendPct(entry.currentPrice, entry.basePrice).toFixed(0);
                    return (
                      <li
                        key={entry.goodId}
                        className="flex items-center justify-between py-1.5 px-3 rounded-lg bg-white/5"
                      >
                        <span className="text-sm text-white">{entry.goodName}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-medium text-white">
                            {entry.currentPrice.toLocaleString()} CR
                          </span>
                          <span
                            className={`text-xs font-medium ${
                              diff > 0
                                ? "text-green-400"
                                : diff < 0
                                  ? "text-red-400"
                                  : "text-white/40"
                            }`}
                          >
                            {diff > 0 ? "+" : ""}{pct}%
                          </span>
                        </div>
                      </li>
                    );
                  })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
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
