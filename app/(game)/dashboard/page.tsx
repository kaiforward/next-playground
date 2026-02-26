"use client";

import { useFleet } from "@/lib/hooks/use-fleet";
import { PlayerSummary } from "@/components/dashboard/player-summary";
import { ActiveMissionsCard } from "@/components/missions/active-missions-card";
import { PageContainer } from "@/components/ui/page-container";
import { QueryBoundary } from "@/components/ui/query-boundary";

function DashboardContent() {
  const { fleet } = useFleet();

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
      <PlayerSummary fleet={fleet} />
      <QueryBoundary>
        <ActiveMissionsCard />
      </QueryBoundary>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <PageContainer>
      <h1 className="text-2xl font-bold mb-2">Dashboard</h1>
      <p className="text-text-secondary mb-6">
        Your fleet overview. Ship status, cargo, and credits at a glance.
      </p>

      <QueryBoundary>
        <DashboardContent />
      </QueryBoundary>
    </PageContainer>
  );
}
