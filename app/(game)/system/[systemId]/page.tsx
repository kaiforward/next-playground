"use client";

import { use, useState, useEffect } from "react";
import Link from "next/link";
import { useFleet } from "@/lib/hooks/use-fleet";
import { useUniverse } from "@/lib/hooks/use-universe";
import { useTickContext } from "@/lib/hooks/use-tick-context";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/ui/page-container";
import { ECONOMY_BADGE_COLOR } from "@/lib/constants/ui";
import type { MarketEntry } from "@/lib/types/game";

export default function SystemViewPage({
  params,
}: {
  params: Promise<{ systemId: string }>;
}) {
  const { systemId } = use(params);
  const { fleet, loading: fleetLoading, refresh } = useFleet();
  const { data: universeData } = useUniverse();
  const { subscribeToArrivals } = useTickContext();

  useEffect(() => {
    return subscribeToArrivals(() => refresh());
  }, [subscribeToArrivals, refresh]);

  const [market, setMarket] = useState<MarketEntry[]>([]);
  const [marketLoading, setMarketLoading] = useState(true);

  // Fetch market data
  useEffect(() => {
    fetch(`/api/game/market/${systemId}`)
      .then((res) => res.json())
      .then((json) => {
        if (json.data) setMarket(json.data.entries);
      })
      .catch(console.error)
      .finally(() => setMarketLoading(false));
  }, [systemId]);

  if (fleetLoading || !fleet) {
    return (
      <PageContainer size="md">
        <h1 className="text-2xl font-bold mb-2">System</h1>
        <p className="text-white/60">Loading...</p>
      </PageContainer>
    );
  }

  // Get system info from universe data (works even if player has no ships here)
  const systemInfo = universeData?.systems.find((s) => s.id === systemId) ?? null;

  const shipsHere = fleet.ships.filter(
    (s) => s.status === "docked" && s.systemId === systemId
  );

  return (
    <PageContainer size="md">
      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/map"
          className="text-white/40 hover:text-white transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
            <path fillRule="evenodd" d="M17 10a.75.75 0 01-.75.75H5.612l4.158 3.96a.75.75 0 11-1.04 1.08l-5.5-5.25a.75.75 0 010-1.08l5.5-5.25a.75.75 0 111.04 1.08L5.612 9.25H16.25A.75.75 0 0117 10z" clipRule="evenodd" />
          </svg>
        </Link>
        <h1 className="text-2xl font-bold">
          {systemInfo?.name ?? "System"}
        </h1>
        {systemInfo && (
          <Badge color={ECONOMY_BADGE_COLOR[systemInfo.economyType]}>
            {systemInfo.economyType}
          </Badge>
        )}
      </div>

      {systemInfo && (
        <p className="text-white/60 mb-6">{systemInfo.description}</p>
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
                      href={`/ship/${ship.id}`}
                      className="text-sm font-medium text-white hover:text-blue-300 transition-colors"
                    >
                      {ship.name}
                    </Link>
                    <Button href={`/trade?shipId=${ship.id}&systemId=${systemId}`} variant="pill" color="indigo" size="xs">
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
            {marketLoading ? (
              <p className="text-sm text-white/30 py-4 text-center">Loading market...</p>
            ) : market.length === 0 ? (
              <p className="text-sm text-white/30 py-4 text-center">No market data.</p>
            ) : (
              <ul className="space-y-2">
                {[...market]
                  .sort((a, b) => b.currentPrice - a.currentPrice)
                  .slice(0, 6)
                  .map((entry) => {
                    const diff = entry.currentPrice - entry.basePrice;
                    const pct = ((diff / entry.basePrice) * 100).toFixed(0);
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
    </PageContainer>
  );
}
