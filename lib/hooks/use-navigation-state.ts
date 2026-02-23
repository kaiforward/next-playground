"use client";

import { useState, useCallback } from "react";
import type { StarSystemInfo } from "@/lib/types/game";
import type { NavigableUnit } from "@/lib/types/navigable";
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
      unit: NavigableUnit;
      reachable: Map<string, ReachableSystem>;
    }
  | {
      phase: "route_preview";
      unit: NavigableUnit;
      destination: StarSystemInfo;
      route: PathResult;
      reachable: Map<string, ReachableSystem>;
    };

interface UseNavigationStateOptions {
  connections: ConnectionInfo[];
  systems: StarSystemInfo[];
  onNavigateShip: (shipId: string, route: string[]) => Promise<void>;
  onNavigateConvoy?: (convoyId: string, route: string[]) => Promise<void>;
}

export function useNavigationState({
  connections,
  systems,
  onNavigateShip,
  onNavigateConvoy,
}: UseNavigationStateOptions) {
  const [mode, setMode] = useState<NavigationMode>({ phase: "default" });
  const [isNavigating, setIsNavigating] = useState(false);

  const selectUnit = useCallback(
    (unit: NavigableUnit) => {
      const reachable = findReachableSystems(
        unit.systemId,
        unit.fuel,
        connections,
        unit.speed,
      );
      setMode({ phase: "unit_selected", unit, reachable });
    },
    [connections],
  );

  const selectDestination = useCallback(
    (system: StarSystemInfo) => {
      if (mode.phase !== "unit_selected") return;

      const route = findShortestPath(
        mode.unit.systemId,
        system.id,
        connections,
        mode.unit.speed,
      );
      if (!route) return;

      setMode({
        phase: "route_preview",
        unit: mode.unit,
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
      if (mode.unit.kind === "convoy" && onNavigateConvoy) {
        await onNavigateConvoy(mode.unit.id, mode.route.path);
      } else if (mode.unit.kind === "ship") {
        await onNavigateShip(mode.unit.id, mode.route.path);
      }
      setMode({ phase: "default" });
    } finally {
      setIsNavigating(false);
    }
  }, [mode, onNavigateShip, onNavigateConvoy]);

  const cancel = useCallback(() => {
    setMode({ phase: "default" });
  }, []);

  return {
    mode,
    selectUnit,
    selectDestination,
    confirmNavigation,
    cancel,
    isNavigating,
  };
}
