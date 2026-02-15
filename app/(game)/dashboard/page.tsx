"use client";

import { useFleet } from "@/lib/hooks/use-fleet";
import { useUniverse } from "@/lib/hooks/use-universe";
import { useTickContext } from "@/lib/hooks/use-tick-context";
import { PlayerSummary } from "@/components/dashboard/player-summary";
import { FleetOverview } from "@/components/fleet/fleet-overview";
import { ActiveMissionsCard } from "@/components/missions/active-missions-card";
import { PageContainer } from "@/components/ui/page-container";
import { QueryBoundary } from "@/components/ui/query-boundary";

function FleetSection() {
  const { fleet } = useFleet();
  const { data: universeData } = useUniverse();
  const { currentTick } = useTickContext();

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-8">
        <PlayerSummary fleet={fleet} />
        <QueryBoundary>
          <ActiveMissionsCard />
        </QueryBoundary>
      </div>

      <FleetOverview
        ships={fleet.ships}
        currentTick={currentTick}
        regions={universeData.regions}
        playerCredits={fleet.credits}
      />
    </>
  );
}

export default function DashboardPage() {
  return (
    <PageContainer>
      <h1 className="text-2xl font-bold mb-2">Command Center</h1>
      <p className="text-white/60 mb-6">
        Your fleet overview. Ship status, cargo, and credits at a glance.
      </p>

      <QueryBoundary>
        <FleetSection />
      </QueryBoundary>
    </PageContainer>
  );
}
