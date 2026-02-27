"use client";

import { useMemo } from "react";
import type {
  UniverseData,
  StarSystemInfo,
  ShipState,
  ConvoyState,
  RegionInfo,
  ActiveEvent,
  EconomyType,
} from "@/lib/types/game";
import type { NavigationMode } from "@/lib/hooks/use-navigation-state";
import type { MapViewLevel } from "@/lib/hooks/use-map-view-state";
import { EVENT_TYPE_BADGE_COLOR, EVENT_TYPE_DANGER_PRIORITY } from "@/lib/constants/ui";
import {
  getIntraRegionConnections,
  getInterRegionConnections,
  getGatewayTargetRegions,
} from "@/lib/utils/region";

// ── Types ───────────────────────────────────────────────────────

export type NavigationNodeState =
  | "origin"
  | "reachable"
  | "unreachable"
  | "route_hop"
  | "destination";

export type RegionNavigationState = "origin" | "reachable" | "unreachable";

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
  shipCount: number;
  isGateway: boolean;
  navigationState?: NavigationNodeState;
  activeEvents?: SystemEventInfo[];
}

export interface RegionNodeData {
  id: string;
  x: number;
  y: number;
  name: string;
  dominantEconomy: EconomyType;
  systemCount: number;
  shipCount: number;
  navigationState?: RegionNavigationState;
}

export interface ConnectionData {
  id: string;
  fromId: string;
  toId: string;
  fuelCost: number;
  isRoute: boolean;
  isDimmed: boolean;
}

export interface MapData {
  systems: SystemNodeData[];
  regions: RegionNodeData[];
  connections: ConnectionData[];
  // Detail panel data (unchanged from useMapGraph)
  shipsAtSelected: ShipState[];
  convoysAtSelected: ConvoyState[];
  eventsAtSelected: ActiveEvent[];
  selectedGatewayTargets: { regionId: string; regionName: string }[];
  selectedRegionName: string | undefined;
  activeRegion: RegionInfo | undefined;
  activeRegionSystems: StarSystemInfo[];
  regionNavigationStates: Map<string, RegionNavigationState>;
}

// ── Options ─────────────────────────────────────────────────────

interface UseMapDataOptions {
  universe: UniverseData;
  ships: ShipState[];
  convoys: ConvoyState[];
  events: ActiveEvent[];
  viewLevel: MapViewLevel;
  selectedSystem: StarSystemInfo | null;
  navigationMode: NavigationMode;
  isNavigationActive: boolean;
  systemRegionMap: Map<string, string>;
  regionMap: Map<string, RegionInfo>;
}

// ── Hook ────────────────────────────────────────────────────────

export function useMapData({
  universe,
  ships,
  convoys,
  events,
  viewLevel,
  selectedSystem,
  navigationMode: mode,
  isNavigationActive,
  systemRegionMap,
  regionMap,
}: UseMapDataOptions): MapData {
  // ── Active region systems ─────────────────────────────────────
  const activeRegionSystems = useMemo((): StarSystemInfo[] => {
    if (viewLevel.level !== "system") return [];
    return universe.systems.filter((s) => s.regionId === viewLevel.regionId);
  }, [viewLevel, universe.systems]);

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

  // ── Ships per region ──────────────────────────────────────────
  const shipsPerRegion = useMemo(() => {
    const map: Record<string, number> = {};
    for (const ship of ships) {
      if (ship.status === "docked") {
        const regionId = systemRegionMap.get(ship.systemId);
        if (regionId) {
          map[regionId] = (map[regionId] ?? 0) + 1;
        }
      }
    }
    return map;
  }, [ships, systemRegionMap]);

  // ── Systems per region ────────────────────────────────────────
  const systemsPerRegion = useMemo(() => {
    const map: Record<string, number> = {};
    for (const s of universe.systems) {
      map[s.regionId] = (map[s.regionId] ?? 0) + 1;
    }
    return map;
  }, [universe.systems]);

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

  // ── Events per system ─────────────────────────────────────────
  const eventsPerSystem = useMemo(() => {
    const map = new Map<string, SystemEventInfo[]>();
    for (const event of events) {
      if (!event.systemId) continue;
      const existing = map.get(event.systemId);
      const info: SystemEventInfo = {
        type: event.type,
        color: EVENT_TYPE_BADGE_COLOR[event.type] ?? "slate",
        priority: EVENT_TYPE_DANGER_PRIORITY[event.type] ?? 0,
      };
      if (existing) {
        if (!existing.some((e) => e.type === event.type)) existing.push(info);
      } else {
        map.set(event.systemId, [info]);
      }
    }
    return map;
  }, [events]);

  // ── Events at selected system ─────────────────────────────────
  const eventsAtSelected = useMemo(
    () =>
      selectedSystem
        ? events.filter((e) => e.systemId === selectedSystem.id)
        : [],
    [selectedSystem, events],
  );

  // ── Region navigation states ──────────────────────────────────
  const regionNavigationStates = useMemo((): Map<string, RegionNavigationState> => {
    const states = new Map<string, RegionNavigationState>();
    if (mode.phase === "default") return states;
    const { unit, reachable } = mode;
    const unitRegionId = systemRegionMap.get(unit.systemId);

    for (const region of universe.regions) {
      if (region.id === unitRegionId) {
        states.set(region.id, "origin");
      } else {
        const hasReachable = universe.systems.some(
          (s) => s.regionId === region.id && reachable.has(s.id),
        );
        states.set(region.id, hasReachable ? "reachable" : "unreachable");
      }
    }
    return states;
  }, [mode, systemRegionMap, universe.regions, universe.systems]);

  // ── Node navigation states (system view only) ─────────────────
  const nodeNavigationStates = useMemo((): Map<string, NavigationNodeState> => {
    const states = new Map<string, NavigationNodeState>();
    if (viewLevel.level !== "system") return states;

    if (mode.phase === "unit_selected") {
      const originId = mode.unit.systemId;
      for (const system of activeRegionSystems) {
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

      for (const system of activeRegionSystems) {
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
  }, [mode, activeRegionSystems, viewLevel]);

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

  // ── System nodes ──────────────────────────────────────────────
  const systems = useMemo((): SystemNodeData[] => {
    if (viewLevel.level !== "system") return [];

    return activeRegionSystems.map((system) => ({
      id: system.id,
      x: system.x,
      y: system.y,
      name: system.name,
      economyType: system.economyType,
      shipCount: shipsAtSystem[system.id] ?? 0,
      isGateway: system.isGateway,
      navigationState: nodeNavigationStates.get(system.id),
      activeEvents: eventsPerSystem.get(system.id),
    }));
  }, [viewLevel, activeRegionSystems, shipsAtSystem, nodeNavigationStates, eventsPerSystem]);

  // ── Region nodes ──────────────────────────────────────────────
  const regions = useMemo((): RegionNodeData[] => {
    if (viewLevel.level !== "region") return [];

    return universe.regions.map((region) => ({
      id: region.id,
      x: region.x,
      y: region.y,
      name: region.name,
      dominantEconomy: region.dominantEconomy,
      systemCount: systemsPerRegion[region.id] ?? 0,
      shipCount: shipsPerRegion[region.id] ?? 0,
      navigationState: regionNavigationStates.get(region.id),
    }));
  }, [viewLevel, universe.regions, systemsPerRegion, shipsPerRegion, regionNavigationStates]);

  // ── Connections ───────────────────────────────────────────────
  const connections = useMemo((): ConnectionData[] => {
    if (viewLevel.level === "region") {
      // Inter-region connections (deduplicated)
      const crossConns = getInterRegionConnections(universe.connections, systemRegionMap);
      const seen = new Set<string>();
      const result: ConnectionData[] = [];

      for (const c of crossConns) {
        const rFrom = systemRegionMap.get(c.fromSystemId)!;
        const rTo = systemRegionMap.get(c.toSystemId)!;
        const pairKey = [rFrom, rTo].sort().join("--");
        if (seen.has(pairKey)) continue;
        seen.add(pairKey);

        result.push({
          id: `region-${pairKey}`,
          fromId: rFrom,
          toId: rTo,
          fuelCost: 0,  // not shown for region connections
          isRoute: false,
          isDimmed: false,
        });
      }
      return result;
    }

    // Intra-region connections (deduplicated)
    const regionConns = getIntraRegionConnections(
      viewLevel.regionId,
      universe.connections,
      systemRegionMap,
    );
    const seen = new Set<string>();
    const result: ConnectionData[] = [];

    for (const conn of regionConns) {
      const pairKey = [conn.fromSystemId, conn.toSystemId].sort().join("--");
      if (seen.has(pairKey)) continue;
      seen.add(pairKey);

      const isRouteEdge = routeEdgeSet.has(pairKey);
      result.push({
        id: conn.id,
        fromId: conn.fromSystemId,
        toId: conn.toSystemId,
        fuelCost: conn.fuelCost,
        isRoute: isRouteEdge,
        isDimmed: isNavigationActive && !isRouteEdge,
      });
    }

    return result;
  }, [viewLevel, universe.connections, systemRegionMap, routeEdgeSet, isNavigationActive]);

  // ── Gateway target regions ────────────────────────────────────
  const selectedGatewayTargets = useMemo(() => {
    if (!selectedSystem?.isGateway) return [];
    const targetRegionIds = getGatewayTargetRegions(
      selectedSystem.id,
      universe.connections,
      systemRegionMap,
    );
    return targetRegionIds
      .map((rid) => {
        const region = regionMap.get(rid);
        return region ? { regionId: rid, regionName: region.name } : null;
      })
      .filter((t): t is { regionId: string; regionName: string } => t !== null);
  }, [selectedSystem, universe.connections, systemRegionMap, regionMap]);

  // ── Active region info ────────────────────────────────────────
  const activeRegion = useMemo(
    (): RegionInfo | undefined =>
      viewLevel.level === "system" ? regionMap.get(viewLevel.regionId) : undefined,
    [viewLevel, regionMap],
  );

  // ── Selected system region name ───────────────────────────────
  const selectedRegionName = useMemo(
    () => (selectedSystem ? regionMap.get(selectedSystem.regionId)?.name : undefined),
    [selectedSystem, regionMap],
  );

  return {
    systems,
    regions,
    connections,
    shipsAtSelected,
    convoysAtSelected,
    eventsAtSelected,
    selectedGatewayTargets,
    selectedRegionName,
    activeRegion,
    activeRegionSystems,
    regionNavigationStates,
  };
}
