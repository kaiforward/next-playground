"use client";

import { useMemo } from "react";
import type {
  UniverseData,
  StarSystemInfo,
  ShipState,
  ConvoyState,
  ActiveEvent,
  DynamicTileSystem,
  EconomyType,
  SystemVisibility,
} from "@/lib/types/game";
import type { NavigationMode } from "@/lib/hooks/use-navigation-state";
import { EVENT_TYPE_BADGE_COLOR, EVENT_TYPE_DANGER_PRIORITY } from "@/lib/constants/ui";

// ── Types ───────────────────────────────────────────────────────

export type NavigationNodeState =
  | "origin"
  | "reachable"
  | "unreachable"
  | "route_hop"
  | "destination";

export interface SystemEventInfo {
  type: string;
  color: "red" | "amber" | "purple" | "green" | "blue" | "slate";
  priority: number;
}

export interface SystemNodeData {
  id: string;
  x: number;
  y: number;
  name: string;
  economyType: EconomyType;
  regionId: string;
  shipCount: number;
  isGateway: boolean;
  visibility: SystemVisibility;
  navigationState?: NavigationNodeState;
  activeEvents?: SystemEventInfo[];
}

export interface ConnectionData {
  id: string;
  fromId: string;
  toId: string;
  fuelCost: number;
  isGateway: boolean;
  isRoute: boolean;
  isDimmed: boolean;
}

export interface MapData {
  systems: SystemNodeData[];
  connections: ConnectionData[];
  // Detail panel data
  shipsAtSelected: ShipState[];
  convoysAtSelected: ConvoyState[];
  eventsAtSelected: ActiveEvent[];
  selectedGatewayTargets: { regionId: string; regionName: string }[];
  selectedRegionName: string | undefined;
  selectedVisibility: SystemVisibility;
  allSystems: StarSystemInfo[];
}

// ── Options ─────────────────────────────────────────────────────

interface UseMapDataOptions {
  universe: UniverseData;
  ships: ShipState[];
  convoys: ConvoyState[];
  events: ActiveEvent[];
  dynamicSystems: DynamicTileSystem[];
  selectedSystem: StarSystemInfo | null;
  navigationMode: NavigationMode;
  isNavigationActive: boolean;
  systemRegionMap: Map<string, string>;
  regionMap: Map<string, { id: string; name: string }>;
}

// ── Hook ────────────────────────────────────────────────────────

export function useMapData({
  universe,
  ships,
  convoys,
  events,
  dynamicSystems,
  selectedSystem,
  navigationMode: mode,
  isNavigationActive,
  systemRegionMap,
  regionMap,
}: UseMapDataOptions): MapData {
  // ── Ship counts per system (docked only) ──────────────────────
  const shipsAtSystem = useMemo(() => {
    const map: Record<string, number> = {};
    for (const ship of ships) {
      if (ship.status === "docked") {
        map[ship.systemId] = (map[ship.systemId] ?? 0) + 1;
      }
    }
    return map;
  }, [ships]);

  // ── Solo ships docked at selected system ──────────────────────
  const shipsAtSelected = useMemo(
    () =>
      selectedSystem
        ? ships.filter(
            (s) => s.status === "docked" && s.systemId === selectedSystem.id && !s.convoyId,
          )
        : [],
    [selectedSystem, ships],
  );

  // ── Convoys docked at selected system ─────────────────────────
  const convoysAtSelected = useMemo(
    () =>
      selectedSystem
        ? convoys.filter(
            (c) => c.status === "docked" && c.systemId === selectedSystem.id,
          )
        : [],
    [selectedSystem, convoys],
  );

  // ── Visibility lookup from dynamic tiles ─────────────────────
  const visibilityMap = useMemo(() => {
    const map = new Map<string, DynamicTileSystem>();
    for (const ds of dynamicSystems) {
      map.set(ds.id, ds);
    }
    return map;
  }, [dynamicSystems]);

  // ── Events per system (from dynamic tiles, visibility-gated) ─
  const eventsPerSystem = useMemo(() => {
    const map = new Map<string, SystemEventInfo[]>();
    for (const ds of dynamicSystems) {
      if (ds.visibility !== "visible" || ds.eventTypeIds.length === 0) continue;
      map.set(
        ds.id,
        ds.eventTypeIds.map((type) => ({
          type,
          color: EVENT_TYPE_BADGE_COLOR[type] ?? "slate",
          priority: EVENT_TYPE_DANGER_PRIORITY[type] ?? 0,
        })),
      );
    }
    return map;
  }, [dynamicSystems]);

  // ── Events at selected system (gated by visibility) ──────────
  const eventsAtSelected = useMemo(() => {
    if (!selectedSystem) return [];
    const ds = visibilityMap.get(selectedSystem.id);
    if (!ds || ds.visibility !== "visible") return [];
    return events.filter((e) => e.systemId === selectedSystem.id);
  }, [selectedSystem, events, visibilityMap]);

  // ── Node navigation states (all systems) ──────────────────────
  const nodeNavigationStates = useMemo((): Map<string, NavigationNodeState> => {
    const states = new Map<string, NavigationNodeState>();

    if (mode.phase === "unit_selected") {
      const originId = mode.unit.systemId;
      for (const system of universe.systems) {
        if (system.id === originId) {
          states.set(system.id, "origin");
        } else if (mode.reachable.has(system.id)) {
          states.set(system.id, "reachable");
        } else {
          states.set(system.id, "unreachable");
        }
      }
    } else if (mode.phase === "route_preview") {
      const originId = mode.unit.systemId;
      const destId = mode.destination.id;
      const routeSet = new Set(mode.route.path);

      for (const system of universe.systems) {
        if (system.id === originId) {
          states.set(system.id, "origin");
        } else if (system.id === destId) {
          states.set(system.id, "destination");
        } else if (routeSet.has(system.id)) {
          states.set(system.id, "route_hop");
        } else if (mode.reachable.has(system.id)) {
          states.set(system.id, "reachable");
        } else {
          states.set(system.id, "unreachable");
        }
      }
    }

    return states;
  }, [mode, universe.systems]);

  // ── Route edges set ───────────────────────────────────────────
  const routeEdgeSet = useMemo((): Set<string> => {
    if (mode.phase !== "route_preview") return new Set();
    const set = new Set<string>();
    for (let i = 0; i < mode.route.path.length - 1; i++) {
      const key = [mode.route.path[i], mode.route.path[i + 1]].sort().join("--");
      set.add(key);
    }
    return set;
  }, [mode]);

  // ── System nodes (all systems) ────────────────────────────────
  const systems = useMemo((): SystemNodeData[] => {
    return universe.systems.map((system) => {
      const ds = visibilityMap.get(system.id);
      const visibility: SystemVisibility = ds?.visibility ?? "unknown";
      return {
        id: system.id,
        x: system.x,
        y: system.y,
        name: system.name,
        economyType: system.economyType,
        regionId: system.regionId,
        shipCount: shipsAtSystem[system.id] ?? 0,
        isGateway: system.isGateway,
        visibility,
        navigationState: nodeNavigationStates.get(system.id),
        activeEvents: eventsPerSystem.get(system.id),
      };
    });
  }, [universe.systems, shipsAtSystem, nodeNavigationStates, eventsPerSystem, visibilityMap]);

  // ── Connections (all, deduplicated) ───────────────────────────
  const connections = useMemo((): ConnectionData[] => {
    const seen = new Set<string>();
    const result: ConnectionData[] = [];

    for (const conn of universe.connections) {
      const pairKey = [conn.fromSystemId, conn.toSystemId].sort().join("--");
      if (seen.has(pairKey)) continue;
      seen.add(pairKey);

      const isRouteEdge = routeEdgeSet.has(pairKey);
      result.push({
        id: conn.id,
        fromId: conn.fromSystemId,
        toId: conn.toSystemId,
        fuelCost: conn.fuelCost,
        isGateway: systemRegionMap.get(conn.fromSystemId) !== systemRegionMap.get(conn.toSystemId),
        isRoute: isRouteEdge,
        isDimmed: isNavigationActive && !isRouteEdge,
      });
    }

    return result;
  }, [universe.connections, systemRegionMap, routeEdgeSet, isNavigationActive]);

  // ── Gateway target regions ────────────────────────────────────
  const selectedGatewayTargets = useMemo(() => {
    if (!selectedSystem?.isGateway) return [];
    const targetRegionIds = new Set<string>();
    const homeRegion = systemRegionMap.get(selectedSystem.id);
    for (const c of universe.connections) {
      if (c.fromSystemId === selectedSystem.id) {
        const targetRegion = systemRegionMap.get(c.toSystemId);
        if (targetRegion && targetRegion !== homeRegion) {
          targetRegionIds.add(targetRegion);
        }
      }
      if (c.toSystemId === selectedSystem.id) {
        const targetRegion = systemRegionMap.get(c.fromSystemId);
        if (targetRegion && targetRegion !== homeRegion) {
          targetRegionIds.add(targetRegion);
        }
      }
    }
    return [...targetRegionIds]
      .map((rid) => {
        const region = regionMap.get(rid);
        return region ? { regionId: rid, regionName: region.name } : null;
      })
      .filter((t): t is { regionId: string; regionName: string } => t !== null);
  }, [selectedSystem, universe.connections, systemRegionMap, regionMap]);

  // ── Selected system region name ───────────────────────────────
  const selectedRegionName = useMemo(
    () => (selectedSystem ? regionMap.get(selectedSystem.regionId)?.name : undefined),
    [selectedSystem, regionMap],
  );

  // ── Selected system visibility ───────────────────────────────
  const selectedVisibility: SystemVisibility = selectedSystem
    ? (visibilityMap.get(selectedSystem.id)?.visibility ?? "unknown")
    : "unknown";

  return {
    systems,
    connections,
    shipsAtSelected,
    convoysAtSelected,
    eventsAtSelected,
    selectedGatewayTargets,
    selectedRegionName,
    selectedVisibility,
    allSystems: universe.systems,
  };
}
