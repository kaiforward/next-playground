"use client";

import { use, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useMarket } from "@/lib/hooks/use-market";
import { useUniverse } from "@/lib/hooks/use-universe";
import { MarketTable } from "@/components/trade/market-table";
import { StockChart } from "@/components/trade/stock-chart";
import { MarketComparisonPanel } from "@/components/market/market-comparison-panel";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { EmptyState } from "@/components/ui/empty-state";

function MarketContent({ systemId }: { systemId: string }) {
  const router = useRouter();

  const { market } = useMarket(systemId);
  const { data: universe } = useUniverse();

  const [comparison, setComparison] = useState<
    { goodId: string; goodName: string } | null
  >(null);

  const fromSystemName = useMemo(
    () => universe.systems.find((s) => s.id === systemId)?.name ?? "Here",
    [universe.systems, systemId],
  );

  const universeSystems = useMemo(
    () => universe.systems.map((s) => ({ id: s.id, name: s.name })),
    [universe.systems],
  );

  const universeConnections = useMemo(
    () =>
      universe.connections.map((c) => ({
        fromSystemId: c.fromSystemId,
        toSystemId: c.toSystemId,
        fuelCost: c.fuelCost,
      })),
    [universe.connections],
  );

  // A non-developed system has no market (getMarket returns no entries); the tab is
  // hidden for it, but the route is still reachable directly.
  if (market.length === 0) {
    return <EmptyState message="This system isn't developed yet — no market here." />;
  }

  return (
    <>
      {/* Market table — read-only inspection of current prices and stock */}
      <div className="bg-surface backdrop-blur border border-border overflow-hidden">
        <MarketTable
          entries={market}
          onCompareGood={(goodId, goodName) =>
            setComparison({ goodId, goodName })
          }
        />
      </div>

      {/* Stock levels */}
      <div className="mt-8">
        <StockChart entries={market} />
      </div>

      {comparison && (
        <MarketComparisonPanel
          goodId={comparison.goodId}
          goodName={comparison.goodName}
          fromSystemId={systemId}
          fromSystemName={fromSystemName}
          systems={universeSystems}
          connections={universeConnections}
          onSelectSystem={(sysId) => {
            router.push(`/?systemId=${sysId}`);
            setComparison(null);
          }}
          onClose={() => setComparison(null)}
        />
      )}
    </>
  );
}

export default function SystemMarketPage({
  params,
}: {
  params: Promise<{ systemId: string }>;
}) {
  const { systemId } = use(params);

  return (
    <QueryBoundary>
      <MarketContent systemId={systemId} />
    </QueryBoundary>
  );
}
