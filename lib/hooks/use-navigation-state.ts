"use client";

import { useState, useCallback } from "react";
import type { StarSystemInfo, ShipState } from "@/lib/types/game";
import type { ConnectionInfo } from "@/lib/engine/navigation";
import {
  findReachableSystems,
  findShortestPath,
  type PathResult,
  type ReachableSystem,
} from "@/lib/engine/pathfinding";

// ── State types ─────────────────────────────────────────────────

export type NavigationMode =
  | { phase: "default" }
  | {
      phase: "unit_selected";
      ship: ShipState;
      reachable: Map<string, ReachableSystem>;
    }
  | {
      phase: "route_preview";
      ship: ShipState;
      destination: StarSystemInfo;
      route: PathResult;
      reachable: Map<string, ReachableSystem>;
    };

interface UseNavigationStateOptions {
  connections: ConnectionInfo[];
  systems: StarSystemInfo[];
  onNavigateShip: (shipId: string, route: string[]) => Promise<void>;
}

export function useNavigationState({
  connections,
  onNavigateShip,
}: UseNavigationStateOptions) {
  const [mode, setMode] = useState<NavigationMode>({ phase: "default" });
  const [isNavigating, setIsNavigating] = useState(false);

  const selectShip = useCallback(
    (ship: ShipState) => {
      const reachable = findReachableSystems(
        ship.systemId,
        ship.fuel,
        connections,
        ship.speed,
      );
      setMode({ phase: "unit_selected", ship, reachable });
    },
    [connections],
  );

  const selectDestination = useCallback(
    (system: StarSystemInfo) => {
      // Allowed from both unit_selected and route_preview so the player can
      // re-pick a destination any number of times before confirming. Both
      // phases carry the same `ship` and `reachable` set.
      if (mode.phase !== "unit_selected" && mode.phase !== "route_preview") {
        return;
      }

      const route = findShortestPath(
        mode.ship.systemId,
        system.id,
        connections,
        mode.ship.speed,
      );
      if (!route) return;

      setMode({
        phase: "route_preview",
        ship: mode.ship,
        destination: system,
        route,
        reachable: mode.reachable,
      });
    },
    [mode, connections],
  );

  const confirmNavigation = useCallback(async () => {
    if (mode.phase !== "route_preview") return;

    setIsNavigating(true);
    try {
      await onNavigateShip(mode.ship.id, mode.route.path);
      setMode({ phase: "default" });
    } finally {
      setIsNavigating(false);
    }
  }, [mode, onNavigateShip]);

  const cancel = useCallback(() => {
    setMode({ phase: "default" });
  }, []);

  return {
    mode,
    selectShip,
    selectDestination,
    confirmNavigation,
    cancel,
    isNavigating,
  };
}
