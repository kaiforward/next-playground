"use client";

import { use, useMemo } from "react";
import { useFleet } from "@/lib/hooks/use-fleet";
import { useConvoys } from "@/lib/hooks/use-convoy";
import { useMarket } from "@/lib/hooks/use-market";
import { useEvents } from "@/lib/hooks/use-events";
import { useUniverse } from "@/lib/hooks/use-universe";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { ActiveEventsSection } from "@/components/events/active-events-section";
import { TraitList } from "@/components/ui/trait-list";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { getPriceTrendPct } from "@/lib/utils/market";
import { enrichTraits } from "@/lib/utils/traits";
import { getDockedShips, getDockedConvoys } from "@/lib/utils/fleet";

function SystemOverviewContent({ systemId }: { systemId: string }) {
  const { fleet } = useFleet();
  const { convoys } = useConvoys();
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

  const soloShips = useMemo(
    () => getDockedShips(fleet.ships, systemId),
    [fleet.ships, systemId],
  );
  const dockedConvoys = useMemo(
    () => getDockedConvoys(convoys, systemId),
    [convoys, systemId],
  );
  const totalShips = soloShips.length + dockedConvoys.reduce((sum, c) => sum + c.members.length, 0);

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
        {/* Fleet docked */}
        <Card variant="bordered" padding="md">
          <CardHeader title="Fleet Here" subtitle={`${totalShips} ship${totalShips !== 1 ? "s" : ""} docked`} />
          <CardContent>
            {soloShips.length === 0 && dockedConvoys.length === 0 ? (
              <p className="text-sm text-white/30 py-4 text-center">
                No ships docked at this system.
              </p>
            ) : (
              <div className="space-y-1">
                {soloShips.length > 0 && (
                  <p className="text-sm text-white/70">
                    {soloShips.length} solo {soloShips.length === 1 ? "ship" : "ships"}
                  </p>
                )}
                {dockedConvoys.length > 0 && (
                  <p className="text-sm text-white/70">
                    {dockedConvoys.length} {dockedConvoys.length === 1 ? "convoy" : "convoys"} ({dockedConvoys.reduce((sum, c) => sum + c.members.length, 0)} ships)
                  </p>
                )}
              </div>
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
