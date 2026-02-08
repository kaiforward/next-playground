"use client";

import { usePlayer } from "@/lib/hooks/use-player";
import { PlayerSummary } from "@/components/dashboard/player-summary";
import { ShipStatus } from "@/components/dashboard/ship-status";
import { CargoList } from "@/components/dashboard/cargo-list";

export default function DashboardPage() {
  const { player, loading } = usePlayer();

  if (loading || !player) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold mb-2">Dashboard</h1>
        <p className="text-white/60">Loading your command center...</p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-2">Dashboard</h1>
      <p className="text-white/60 mb-6">
        Your command center. Ship status, cargo, and credits at a glance.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <PlayerSummary player={player} />
        <ShipStatus ship={player.ship} />
        <CargoList cargo={player.ship.cargo} cargoMax={player.ship.cargoMax} />
      </div>
    </div>
  );
}
