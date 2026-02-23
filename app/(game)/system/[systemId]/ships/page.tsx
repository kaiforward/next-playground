"use client";

import { use, useMemo } from "react";
import { useFleet } from "@/lib/hooks/use-fleet";
import { useUniverse } from "@/lib/hooks/use-universe";
import { useTickContext } from "@/lib/hooks/use-tick-context";
import { useConvoys } from "@/lib/hooks/use-convoy";
import { ShipCard } from "@/components/fleet/ship-card";
import { ConvoyPanel } from "@/components/fleet/convoy-panel";
import { QueryBoundary } from "@/components/ui/query-boundary";

function ShipsContent({ systemId }: { systemId: string }) {
  const { fleet } = useFleet();
  const { data: universeData } = useUniverse();
  const { currentTick } = useTickContext();
  const { convoys } = useConvoys();

  const shipsHere = useMemo(
    () => fleet.ships.filter((s) => s.status === "docked" && s.systemId === systemId && !s.convoyId),
    [fleet, systemId],
  );

  if (shipsHere.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-white/40 text-sm">No ships docked at this system.</p>
        <p className="text-white/20 text-xs mt-1">Navigate a ship here from the map to see it.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {shipsHere.map((ship) => (
          <ShipCard
            key={ship.id}
            ship={ship}
            currentTick={currentTick}
            regions={universeData.regions}
            backTo={`system-${systemId}/ships`}
            playerCredits={fleet.credits}
          />
        ))}
      </div>

      <ConvoyPanel
        convoys={convoys}
        ships={fleet.ships}
        systemId={systemId}
      />
    </div>
  );
}

export default function SystemShipsPage({
  params,
}: {
  params: Promise<{ systemId: string }>;
}) {
  const { systemId } = use(params);

  return (
    <QueryBoundary>
      <ShipsContent systemId={systemId} />
    </QueryBoundary>
  );
}
