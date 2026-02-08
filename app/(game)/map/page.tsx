"use client";

import { useCallback } from "react";
import { StarMap } from "@/components/map/star-map";
import { useUniverse } from "@/lib/hooks/use-universe";
import { usePlayer } from "@/lib/hooks/use-player";

export default function MapPage() {
  const { data, loading: universeLoading } = useUniverse();
  const { player, loading: playerLoading, refresh } = usePlayer();

  const handleNavigate = useCallback(
    async (targetSystemId: string) => {
      const res = await fetch("/api/game/navigate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetSystemId }),
      });
      const json = await res.json();
      if (json.error) {
        alert(json.error);
      } else {
        refresh();
      }
    },
    [refresh]
  );

  if (universeLoading || playerLoading || !data || !player) {
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
    <div className="h-[calc(100vh-60px)] w-full">
      <StarMap
        universe={data}
        initialPlayerSystemId={player.systemId}
        onNavigate={handleNavigate}
      />
    </div>
  );
}
