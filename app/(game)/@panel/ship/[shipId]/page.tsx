"use client";

import { use } from "react";
import { useFleet } from "@/lib/hooks/use-fleet";
import { useUniverse } from "@/lib/hooks/use-universe";
import { useTickContext } from "@/lib/hooks/use-tick-context";
import { usePlayerMissions } from "@/lib/hooks/use-player-missions";
import { useActiveBattles } from "@/lib/hooks/use-battles";
import { useConvoys } from "@/lib/hooks/use-convoy";
import { ShipDetailPanel } from "@/components/fleet/ship-detail-panel";
import { BattleViewer } from "@/components/fleet/battle-viewer";
import { DetailPanel } from "@/components/ui/detail-panel";
import { Button } from "@/components/ui/button";
import { QueryBoundary } from "@/components/ui/query-boundary";

function ShipPanelContent({ shipId }: { shipId: string }) {
  const { fleet } = useFleet();
  const { data: universeData } = useUniverse();
  const { currentTick } = useTickContext();
  const { missions } = usePlayerMissions();
  const { battles } = useActiveBattles();
  const { convoys } = useConvoys();

  const ship = fleet.ships.find((s) => s.id === shipId);
  const shipConvoy = ship?.convoyId
    ? convoys.find((c) => c.id === ship.convoyId)
    : undefined;

  if (!ship) {
    return (
      <DetailPanel title="Ship Not Found">
        <p className="text-white/60 mb-4">This ship does not exist or does not belong to you.</p>
        <Button href="/" variant="ghost" size="sm">
          Back to Star Map
        </Button>
      </DetailPanel>
    );
  }

  const shipBattle = battles.find(
    (b) => b.shipId === shipId && b.status === "active",
  );

  return (
    <DetailPanel title={ship.name} subtitle={`${ship.role} — ${ship.system.name}`}>
      {shipBattle && (
        <div className="mb-6">
          <BattleViewer battle={shipBattle} />
        </div>
      )}

      <ShipDetailPanel
        ship={ship}
        currentTick={currentTick}
        regions={universeData.regions}
        playerCredits={fleet.credits}
        convoyName={shipConvoy?.name ?? (shipConvoy ? "Convoy" : undefined)}
        deliverableMissions={
          ship.status === "docked"
            ? missions.filter((m) => {
                if (m.destinationId !== ship.systemId) return false;
                const cargoItem = ship.cargo.find((c) => c.goodId === m.goodId);
                return (cargoItem?.quantity ?? 0) >= m.quantity;
              })
            : undefined
        }
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
