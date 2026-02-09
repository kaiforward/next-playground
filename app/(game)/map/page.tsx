"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { StarMap } from "@/components/map/star-map";
import { useUniverse } from "@/lib/hooks/use-universe";
import { useFleet } from "@/lib/hooks/use-fleet";
import { useTickContext } from "@/lib/hooks/use-tick-context";

export default function MapPage() {
  const searchParams = useSearchParams();
  const initialShipId = searchParams.get("shipId") ?? undefined;

  const { data, loading: universeLoading } = useUniverse();
  const { fleet, loading: fleetLoading, refresh } = useFleet();
  const { currentTick, subscribeToArrivals } = useTickContext();
  const [navError, setNavError] = useState<string | null>(null);

  useEffect(() => {
    return subscribeToArrivals(() => refresh());
  }, [subscribeToArrivals, refresh]);

  const handleNavigateShip = useCallback(
    async (shipId: string, route: string[]) => {
      setNavError(null);
      const res = await fetch(`/api/game/ship/${shipId}/navigate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ route }),
      });
      const json = await res.json();
      if (json.error) {
        setNavError(json.error);
      } else {
        refresh();
      }
    },
    [refresh],
  );

  if (universeLoading || fleetLoading || !data || !fleet) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-60px)] w-full">
        <div className="text-center space-y-3">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
          <p className="text-sm text-gray-400">Loading star map...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-60px)] w-full relative">
      {navError && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-red-900/90 border border-red-500/40 text-red-200 text-sm px-4 py-2 rounded-lg shadow-lg flex items-center gap-3">
          <span>{navError}</span>
          <button onClick={() => setNavError(null)} className="text-red-400 hover:text-white text-xs font-medium">Dismiss</button>
        </div>
      )}
      <StarMap
        universe={data}
        ships={fleet.ships}
        currentTick={currentTick}
        onNavigateShip={handleNavigateShip}
        initialSelectedShipId={initialShipId}
      />
    </div>
  );
}
