"use client";

import { useEffect } from "react";
import { useFleet } from "@/lib/hooks/use-fleet";
import { useTickContext } from "@/lib/hooks/use-tick-context";
import { PlayerSummary } from "@/components/dashboard/player-summary";
import { FleetOverview } from "@/components/fleet/fleet-overview";

export default function DashboardPage() {
  const { fleet, loading: fleetLoading, refresh: refreshFleet } = useFleet();
  const { currentTick, subscribeToArrivals } = useTickContext();

  useEffect(() => {
    return subscribeToArrivals(() => refreshFleet());
  }, [subscribeToArrivals, refreshFleet]);

  if (fleetLoading || !fleet) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold mb-2">Command Center</h1>
        <p className="text-white/60">Loading your fleet...</p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-2">Command Center</h1>
      <p className="text-white/60 mb-6">
        Your fleet overview. Ship status, cargo, and credits at a glance.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-8">
        <PlayerSummary fleet={fleet} />
      </div>

      <FleetOverview ships={fleet.ships} currentTick={currentTick} />
    </div>
  );
}
