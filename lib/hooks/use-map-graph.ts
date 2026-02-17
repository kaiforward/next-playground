"use client";

import { useMemo } from "react";
import type { Node, Edge } from "@xyflow/react";
import type {
  UniverseData,
  StarSystemInfo,
  ShipState,
  RegionInfo,
  ActiveEvent,
} from "@/lib/types/game";
import type { NavigationMode } from "@/lib/hooks/use-navigation-state";
import type { NavigationNodeState, SystemEventInfo } from "@/components/map/system-node";
import type { MapViewLevel } from "@/lib/hooks/use-map-view-state";
import { EVENT_TYPE_BADGE_COLOR, EVENT_TYPE_DANGER_PRIORITY } from "@/lib/constants/ui";
import {
  getIntraRegionConnections,
  getInterRegionConnections,
  getGatewayTargetRegions,
} from "@/lib/utils/region";

// ── Edge colors ─────────────────────────────────────────────────

const EDGE_COLOR = "rgba(148, 163, 184, 0.4)";
const EDGE_DIM = "rgba(148, 163, 184, 0.12)";
const EDGE_ROUTE = "rgba(99, 179, 237, 0.9)";
const EDGE_REGION = "rgba(148, 163, 184, 0.5)";

// ── Types ───────────────────────────────────────────────────────

interface UseMapGraphOptions {
  universe: UniverseData;
  ships: ShipState[];
  events: ActiveEvent[];
  viewLevel: MapViewLevel;
  selectedSystem: StarSystemInfo | null;
  navigationMode: NavigationMode;
  isNavigationActive: boolean;
  systemRegionMap: Map<string, string>;
  regionMap: Map<string, RegionInfo>;
}

export interface MapGraphData {
  // ReactFlow data
  nodes: Node[];
  edges: Edge[];
  activeRegionSystems: StarSystemInfo[];
  // Detail panel data
  shipsAtSelected: ShipState[];
  eventsAtSelected: ActiveEvent[];
  selectedGatewayTargets: { regionId: string; regionName: string }[];
  selectedRegionName: string | undefined;
  activeRegion: RegionInfo | undefined;
  // Navigation (needed by onNodeClick)
  regionNavigationStates: Map<string, "origin" | "reachable" | "unreachable">;
}

// ── Hook ────────────────────────────────────────────────────────

export function useMapGraph({
  universe,
  ships,
  events,
  viewLevel,
  selectedSystem,
  navigationMode: mode,
  isNavigationActive,
  systemRegionMap,
  regionMap,
}: UseMapGraphOptions): MapGraphData {
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

  // ── Ships docked at selected system ───────────────────────────
  const shipsAtSelected = useMemo(
    () =>
      selectedSystem
        ? ships.filter(
            (s) => s.status === "docked" && s.systemId === selectedSystem.id,
          )
        : [],
    [selectedSystem, ships],
  );

  // ── Events per system (deduplicated, with color + priority) ───
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

  // ── Navigation state per region (region view during nav) ──────
  const regionNavigationStates = useMemo((): Map<
    string,
    "origin" | "reachable" | "unreachable"
  > => {
    const states = new Map<string, "origin" | "reachable" | "unreachable">();
    if (mode.phase === "default") return states;
    const { ship, reachable } = mode;

    const shipRegionId = systemRegionMap.get(ship.systemId);

    for (const region of universe.regions) {
      if (region.id === shipRegionId) {
        states.set(region.id, "origin");
      } else {
        const hasReachable = universe.systems.some(
          (s) => s.regionId === region.id && reachable.has(s.id),
        );
        states.set(region.id, hasReachable ? "reachable" : "unreachable");
      }
    }
    return states;
  }, [isNavigationActive, mode, systemRegionMap, universe.regions, universe.systems]);

  // ── Navigation state per node (system view only) ──────────────
  const nodeNavigationStates = useMemo((): Map<string, NavigationNodeState> => {
    const states = new Map<string, NavigationNodeState>();
    if (viewLevel.level !== "system") return states;

    if (mode.phase === "ship_selected") {
      const originId = mode.ship.systemId;
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
      const originId = mode.ship.systemId;
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

  // ── Route edges set (for highlighting) ────────────────────────
  const routeEdgeSet = useMemo((): Set<string> => {
    if (mode.phase !== "route_preview") return new Set();
    const set = new Set<string>();
    for (let i = 0; i < mode.route.path.length - 1; i++) {
      const key = [mode.route.path[i], mode.route.path[i + 1]].sort().join("--");
      set.add(key);
    }
    return set;
  }, [mode]);

  // ── Inter-region edges (for region view) ──────────────────────
  const interRegionEdges = useMemo((): Edge[] => {
    const crossConns = getInterRegionConnections(
      universe.connections,
      systemRegionMap,
    );
    const seen = new Set<string>();
    const result: Edge[] = [];

    for (const c of crossConns) {
      const rFrom = systemRegionMap.get(c.fromSystemId)!;
      const rTo = systemRegionMap.get(c.toSystemId)!;
      const pairKey = [rFrom, rTo].sort().join("--");
      if (seen.has(pairKey)) continue;
      seen.add(pairKey);

      result.push({
        id: `region-${pairKey}`,
        source: rFrom,
        target: rTo,
        style: {
          stroke: EDGE_REGION,
          strokeWidth: 3,
          strokeDasharray: "8 4",
        },
      });
    }
    return result;
  }, [universe.connections, systemRegionMap]);

  // ── Nodes ─────────────────────────────────────────────────────
  const nodes: Node[] = useMemo(() => {
    if (viewLevel.level === "region") {
      return universe.regions.map((region) => ({
        id: region.id,
        type: "regionNode",
        position: { x: region.x, y: region.y },
        data: {
          label: region.name,
          identity: region.identity,
          systemCount: systemsPerRegion[region.id] ?? 0,
          shipCount: shipsPerRegion[region.id] ?? 0,
          navigationState: regionNavigationStates.get(region.id),
        },
      }));
    }

    return activeRegionSystems.map((system) => ({
      id: system.id,
      type: "systemNode",
      position: { x: system.x, y: system.y },
      data: {
        label: system.name,
        economyType: system.economyType,
        shipCount: shipsAtSystem[system.id] ?? 0,
        isGateway: system.isGateway,
        navigationState: nodeNavigationStates.get(system.id),
        activeEvents: eventsPerSystem.get(system.id),
      },
    }));
  }, [
    viewLevel,
    universe.regions,
    activeRegionSystems,
    systemsPerRegion,
    shipsPerRegion,
    shipsAtSystem,
    nodeNavigationStates,
    eventsPerSystem,
    regionNavigationStates,
  ]);

  // ── Edges ─────────────────────────────────────────────────────
  const edges: Edge[] = useMemo(() => {
    if (viewLevel.level === "region") return interRegionEdges;

    const regionConns = getIntraRegionConnections(
      viewLevel.regionId,
      universe.connections,
      systemRegionMap,
    );
    const seen = new Set<string>();
    const dedupedEdges: Edge[] = [];

    for (const conn of regionConns) {
      const pairKey = [conn.fromSystemId, conn.toSystemId].sort().join("--");
      if (seen.has(pairKey)) continue;
      seen.add(pairKey);

      const isRouteEdge = routeEdgeSet.has(pairKey);
      const isNavActive = isNavigationActive;

      dedupedEdges.push({
        id: conn.id,
        source: conn.fromSystemId,
        target: conn.toSystemId,
        style: {
          stroke: isRouteEdge ? EDGE_ROUTE : isNavActive ? EDGE_DIM : EDGE_COLOR,
          strokeWidth: isRouteEdge ? 2.5 : 1.5,
          strokeDasharray: isRouteEdge ? undefined : "6 4",
        },
        animated: isRouteEdge,
        label: `${conn.fuelCost} fuel`,
        labelStyle: {
          fill: isRouteEdge
            ? "rgba(99, 179, 237, 0.9)"
            : "rgba(148, 163, 184, 0.6)",
          fontSize: 10,
          fontWeight: isRouteEdge ? 600 : 500,
        },
        labelBgStyle: {
          fill: "rgba(15, 23, 42, 0.8)",
          fillOpacity: 0.8,
        },
        labelBgPadding: [4, 2] as [number, number],
        labelBgBorderRadius: 4,
      });
    }

    return dedupedEdges;
  }, [
    viewLevel,
    universe.connections,
    systemRegionMap,
    interRegionEdges,
    routeEdgeSet,
    isNavigationActive,
  ]);

  // ── Gateway target regions for detail panel ───────────────────
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

  // ── Active region info for back button ────────────────────────
  const activeRegion: RegionInfo | undefined =
    viewLevel.level === "system"
      ? regionMap.get(viewLevel.regionId)
      : undefined;

  // ── Selected system region name ───────────────────────────────
  const selectedRegionName = selectedSystem
    ? regionMap.get(selectedSystem.regionId)?.name
    : undefined;

  return {
    nodes,
    edges,
    activeRegionSystems,
    shipsAtSelected,
    eventsAtSelected,
    selectedGatewayTargets,
    selectedRegionName,
    activeRegion,
    regionNavigationStates,
  };
}
