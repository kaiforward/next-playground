"use client";

import { use } from "react";
import { useFleet } from "@/lib/hooks/use-fleet";
import { useUniverse } from "@/lib/hooks/use-universe";
import { useTickContext } from "@/lib/hooks/use-tick-context";
import { ShipDetailPanel } from "@/components/fleet/ship-detail-panel";
import { DetailPanel } from "@/components/ui/detail-panel";
import { Button } from "@/components/ui/button";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { MapPinIcon } from "@/components/ui/icons";

function ShipPanelContent({ shipId }: { shipId: string }) {
  const { fleet } = useFleet();
  const { data: universeData } = useUniverse();
  const { currentTick } = useTickContext();

  const ship = fleet.ships.find((s) => s.id === shipId);

  if (!ship) {
    return (
      <DetailPanel title="Ship Not Found" size="lg">
        <p className="text-white/60 mb-4">This ship does not exist or does not belong to you.</p>
        <Button href="/" variant="ghost" size="sm">
          Back to Star Map
        </Button>
      </DetailPanel>
    );
  }

  return (
    <DetailPanel
      title={ship.name}
      subtitle={`${ship.role} — ${ship.system.name}`}
      size="lg"
      headerAction={
        <Button variant="ghost" size="xs" href={`/?systemId=${ship.systemId}`} aria-label="Show on map">
          <MapPinIcon />
          <span className="ml-1">Show on Map</span>
        </Button>
      }
    >
      <ShipDetailPanel
        ship={ship}
        currentTick={currentTick}
        regions={universeData.regions}
        playerCredits={fleet.credits}
      />
    </DetailPanel>
  );
}

export default function ShipPanelPage({
  params,
}: {
  params: Promise<{ shipId: string }>;
}) {
  const { shipId } = use(params);

  return (
    <QueryBoundary>
      <ShipPanelContent shipId={shipId} />
    </QueryBoundary>
  );
}
