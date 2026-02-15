"use client";

import { useCallback, useState } from "react";
import { useSearchParams } from "next/navigation";
import { StarMap } from "@/components/map/star-map";
import { useUniverse } from "@/lib/hooks/use-universe";
import { useFleet } from "@/lib/hooks/use-fleet";
import { useTickContext } from "@/lib/hooks/use-tick-context";
import { useNavigateMutation } from "@/lib/hooks/use-navigate-mutation";
import { useEvents } from "@/lib/hooks/use-events";
import { Button } from "@/components/ui/button";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { LoadingFallback } from "@/components/ui/loading-fallback";

function MapContent({
  initialShipId,
  initialSystemId,
}: {
  initialShipId?: string;
  initialSystemId?: string;
}) {
  const { data } = useUniverse();
  const { fleet } = useFleet();
  const { currentTick } = useTickContext();
  const { mutateAsync: navigateAsync } = useNavigateMutation();
  const { events } = useEvents();
  const [navError, setNavError] = useState<string | null>(null);

  const handleNavigateShip = useCallback(
    async (shipId: string, route: string[]) => {
      setNavError(null);
      try {
        await navigateAsync({ shipId, route });
      } catch (err) {
        setNavError(err instanceof Error ? err.message : "Navigation failed.");
      }
    },
    [navigateAsync],
  );

  return (
    <div className="h-[calc(100vh-60px)] w-full relative">
      {navError && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-red-900/90 border border-red-500/40 text-red-200 text-sm px-4 py-2 rounded-lg shadow-lg flex items-center gap-3">
          <span>{navError}</span>
          <Button variant="dismiss" onClick={() => setNavError(null)}>Dismiss</Button>
        </div>
      )}
      <StarMap
        universe={data}
        ships={fleet.ships}
        currentTick={currentTick}
        onNavigateShip={handleNavigateShip}
        initialSelectedShipId={initialShipId}
        initialSelectedSystemId={initialSystemId}
        events={events}
      />
    </div>
  );
}

export default function MapPage() {
  const searchParams = useSearchParams();
  const initialShipId = searchParams.get("shipId") ?? undefined;
  const initialSystemId = searchParams.get("systemId") ?? undefined;

  return (
    <QueryBoundary
      loadingFallback={
        <LoadingFallback
          message="Loading star map..."
          className="h-[calc(100vh-60px)]"
        />
      }
    >
      <MapContent
        initialShipId={initialShipId}
        initialSystemId={initialSystemId}
      />
    </QueryBoundary>
  );
}
