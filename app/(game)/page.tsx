"use client";

import { useCallback, useState } from "react";
import { useSearchParams } from "next/navigation";
import { StarMap } from "@/components/map/star-map";
import { useAtlas } from "@/lib/hooks/use-atlas";
import { useFleet } from "@/lib/hooks/use-fleet";

import { useNavigateMutation } from "@/lib/hooks/use-navigate-mutation";
import { useEvents } from "@/lib/hooks/use-events";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/inline-alert";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { LoadingFallback } from "@/components/ui/loading-fallback";

function MapContent({
  initialShipId,
  initialSystemId,
}: {
  initialShipId?: string;
  initialSystemId?: string;
}) {
  const { atlas } = useAtlas();
  const { fleet } = useFleet();
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
    <div className="h-[calc(100vh-var(--topbar-height))] w-full relative">
      {navError && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3">
          <InlineAlert className="shadow-lg">{navError}</InlineAlert>
          <Button variant="dismiss" onClick={() => setNavError(null)}>Dismiss</Button>
        </div>
      )}
      <StarMap
        atlas={atlas}
        ships={fleet.ships}
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
  const initialShipId = searchParams.get("navigateShipId") ?? undefined;
  const initialSystemId = searchParams.get("systemId") ?? undefined;

  return (
    <QueryBoundary
      loadingFallback={
        <LoadingFallback
          message="Loading star map..."
          className="h-[calc(100vh-var(--topbar-height))]"
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
