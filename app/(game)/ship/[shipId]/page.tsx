"use client";

import { use } from "react";
import { useSearchParams } from "next/navigation";
import { useFleet } from "@/lib/hooks/use-fleet";
import { useUniverse } from "@/lib/hooks/use-universe";
import { useTickContext } from "@/lib/hooks/use-tick-context";
import { usePlayerMissions } from "@/lib/hooks/use-player-missions";
import { useActiveBattles } from "@/lib/hooks/use-battles";
import { useConvoys } from "@/lib/hooks/use-convoy";
import { ShipDetailPanel } from "@/components/fleet/ship-detail-panel";
import { BattleViewer } from "@/components/fleet/battle-viewer";
import { PageContainer } from "@/components/ui/page-container";
import { Button } from "@/components/ui/button";
import { BackLink } from "@/components/ui/back-link";
import { QueryBoundary } from "@/components/ui/query-boundary";

function ShipDetailContent({ shipId }: { shipId: string }) {
  const searchParams = useSearchParams();
  const { fleet } = useFleet();
  const { data: universeData } = useUniverse();
  const { currentTick } = useTickContext();
  const { missions } = usePlayerMissions();
  const { battles } = useActiveBattles();
  const { convoys } = useConvoys();

  // ?from=system-{id} → back to system page; fallback to dashboard
  const from = searchParams.get("from");
  const backHref = from?.startsWith("system-")
    ? `/system/${from.slice(7)}`
    : "/dashboard";

  const ship = fleet.ships.find((s) => s.id === shipId);
  const shipConvoy = ship?.convoyId
    ? convoys.find((c) => c.id === ship.convoyId)
    : undefined;

  if (!ship) {
    return (
      <>
        <h1 className="text-2xl font-bold mb-2">Ship Not Found</h1>
        <p className="text-white/60 mb-4">This ship does not exist or does not belong to you.</p>
        <Button href="/dashboard" variant="ghost" size="sm">
          Back to Command Center
        </Button>
      </>
    );
  }

  // Find active battle for this ship
  const shipBattle = battles.find(
    (b) => b.shipId === shipId && b.status === "active",
  );

  return (
    <>
      <div className="flex items-center gap-3 mb-6">
        <BackLink href={backHref} />
        <h1 className="text-2xl font-bold">Ship Details</h1>
      </div>

      {/* Battle viewer if ship is in combat */}
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
    </>
  );
}

export default function ShipDetailPage({
  params,
}: {
  params: Promise<{ shipId: string }>;
}) {
  const { shipId } = use(params);

  return (
    <PageContainer size="sm">
      <QueryBoundary>
        <ShipDetailContent shipId={shipId} />
      </QueryBoundary>
    </PageContainer>
  );
}
