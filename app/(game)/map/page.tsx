"use client";

import { useCallback, useState } from "react";
import { useSearchParams } from "next/navigation";
import { StarMap } from "@/components/map/star-map";
import { useUniverse } from "@/lib/hooks/use-universe";
import { useFleet } from "@/lib/hooks/use-fleet";
import { useTickContext } from "@/lib/hooks/use-tick-context";
import { useNavigateMutation } from "@/lib/hooks/use-navigate-mutation";
import { useConvoys, useConvoyNavigateByIdMutation } from "@/lib/hooks/use-convoy";
import { useEvents } from "@/lib/hooks/use-events";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/inline-alert";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { LoadingFallback } from "@/components/ui/loading-fallback";

function MapContent({
  initialShipId,
  initialConvoyId,
  initialSystemId,
}: {
  initialShipId?: string;
  initialConvoyId?: string;
  initialSystemId?: string;
}) {
  const { data } = useUniverse();
  const { fleet } = useFleet();
  const { currentTick } = useTickContext();
  const { mutateAsync: navigateAsync } = useNavigateMutation();
  const { convoys } = useConvoys();
  const convoyNavigate = useConvoyNavigateByIdMutation();
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

  const handleNavigateConvoy = useCallback(
    async (convoyId: string, route: string[]) => {
      setNavError(null);
      try {
        await convoyNavigate.mutateAsync({ convoyId, route });
      } catch (err) {
        setNavError(err instanceof Error ? err.message : "Convoy navigation failed.");
      }
    },
    [convoyNavigate],
  );

  return (
    <div className="h-[calc(100vh-60px)] w-full relative">
      {navError && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3">
          <InlineAlert className="shadow-lg">{navError}</InlineAlert>
          <Button variant="dismiss" onClick={() => setNavError(null)}>Dismiss</Button>
        </div>
      )}
      <StarMap
        universe={data}
        ships={fleet.ships}
        convoys={convoys}
        currentTick={currentTick}
        onNavigateShip={handleNavigateShip}
        onNavigateConvoy={handleNavigateConvoy}
        initialSelectedShipId={initialShipId}
        initialSelectedConvoyId={initialConvoyId}
        initialSelectedSystemId={initialSystemId}
        events={events}
      />
    </div>
  );
}

export default function MapPage() {
  const searchParams = useSearchParams();
  const initialShipId = searchParams.get("shipId") ?? undefined;
  const initialConvoyId = searchParams.get("convoyId") ?? undefined;
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
        initialConvoyId={initialConvoyId}
        initialSystemId={initialSystemId}
      />
    </QueryBoundary>
  );
}
