"use client";

import { use, useMemo } from "react";
import { useFleet } from "@/lib/hooks/use-fleet";
import { useUniverse } from "@/lib/hooks/use-universe";
import { useTickContext } from "@/lib/hooks/use-tick-context";
import { ShipCard } from "@/components/fleet/ship-card";

export default function SystemShipsPage({
  params,
}: {
  params: Promise<{ systemId: string }>;
}) {
  const { systemId } = use(params);
  const { fleet, loading } = useFleet();
  const { data: universeData } = useUniverse();
  const { currentTick } = useTickContext();

  const shipsHere = useMemo(
    () => fleet?.ships.filter((s) => s.status === "docked" && s.systemId === systemId) ?? [],
    [fleet, systemId],
  );

  if (loading || !fleet) {
    return <p className="text-white/60">Loading ships...</p>;
  }

  if (shipsHere.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-white/40 text-sm">No ships docked at this system.</p>
        <p className="text-white/20 text-xs mt-1">Navigate a ship here from the map to see it.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {shipsHere.map((ship) => (
        <ShipCard
          key={ship.id}
          ship={ship}
          currentTick={currentTick}
          regions={universeData?.regions}
          backTo={`system-${systemId}/ships`}
          playerCredits={fleet.credits}
        />
      ))}
    </div>
  );
}
