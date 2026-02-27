"use client";

import { useFleet } from "@/lib/hooks/use-fleet";
import { useUniverse } from "@/lib/hooks/use-universe";
import { useTickContext } from "@/lib/hooks/use-tick-context";
import { FleetOverview } from "@/components/fleet/fleet-overview";
import { DetailPanel } from "@/components/ui/detail-panel";
import { QueryBoundary } from "@/components/ui/query-boundary";

function FleetContent() {
  const { fleet } = useFleet();
  const { data: universeData } = useUniverse();
  const { currentTick } = useTickContext();

  return (
    <FleetOverview
      ships={fleet.ships}
      currentTick={currentTick}
      regions={universeData.regions}
      playerCredits={fleet.credits}
    />
  );
}

export default function FleetPanelPage() {
  return (
    <DetailPanel title="Fleet" size="lg">
      <QueryBoundary>
        <FleetContent />
      </QueryBoundary>
    </DetailPanel>
  );
}
