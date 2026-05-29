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
import type { TradeFlowEdgeInfo } from "@/lib/types/api";
import type { NavigationMode } from "@/lib/hooks/use-navigation-state";
import { EVENT_TYPE_BADGE_COLOR, EVENT_TYPE_DANGER_PRIORITY } from "@/lib/constants/ui";
import { priceRampColorPixi } from "@/lib/utils/price-ramp";

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
  /** Total docked ships incl. convoy members — used for fleet-presence checks. */
  shipCount: number;
  /** Solo docked ships (not in a convoy) — drives the blue docked pill. */
  dockedShipCount: number;
  /** Docked convoys at this system — drives the copper docked pill. */
  dockedConvoyCount: number;
  isGateway: boolean;
  visibility: SystemVisibility;
  navigationState?: NavigationNodeState;
  activeEvents?: SystemEventInfo[];
  /** Price-ramp tint for the active heatmap good, or null when none/overlay off. */
  priceTint: number | null;
  /** Signed % deviation from base price for the active heatmap good, or null when none. */
  priceDelta: number | null;
}

export interface TransitUnit {
  id: string;
  kind: "ship" | "convoy";
  name: string;
  originSystemId: string;
  destinationSystemId: string;
  destinationName: string;
  departureTick: number;
  arrivalTick: number;
  speed: number;
  memberCount: number;
  cargoUsed: number;
  cargoMax: number;
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
  /**
   * Trade-flow edges keyed by canonical edge id `${fromId}|${toId}` (sorted).
   * Empty when the Trade Flows overlay is off — the Pixi layer renders nothing.
   */
  flowEdges: Map<string, TradeFlowEdgeInfo>;
  /** Per-system price data for the active heatmap good. Null when overlay is off. */
  priceHeatmap: Map<string, { currentPrice: number; basePrice: number }> | null;
  // Detail panel data
  shipsAtSelected: ShipState[];
  convoysAtSelected: ConvoyState[];
  transitUnits: TransitUnit[];
  eventsAtSelected: ActiveEvent[];
  selectedGatewayTargets: { regionId: string; regionName: string }[];
  selectedRegionName: string | undefined;
  selectedFactionName: string | undefined;
  selectedVisibility: SystemVisibility;
  allSystems: StarSystemInfo[];
}

// ── Options ─────────────────────────────────────────────────────

interface UseMapDataOptions {
  universe: UniverseData;
  ships: ShipState[];
  convoys: ConvoyState[];
  events: ActiveEvent[];
  visibleSystemIds: Set<string>;
  dynamicSystems: DynamicTileSystem[];
  tradeFlowEdges: TradeFlowEdgeInfo[];
  selectedSystem: StarSystemInfo | null;
  navigationMode: NavigationMode;
  isNavigationActive: boolean;
  systemRegionMap: Map<string, string>;
  regionMap: Map<string, { id: string; name: string }>;
  priceHeatmap: Map<string, { currentPrice: number; basePrice: number }> | null;
}

// ── Hook ────────────────────────────────────────────────────────

export function useMapData({
  universe,
  ships,
  convoys,
  events,
  visibleSystemIds,
  dynamicSystems,
  tradeFlowEdges,
  selectedSystem,
  navigationMode: mode,
  isNavigationActive,
  systemRegionMap,
  regionMap,
  priceHeatmap,
}: UseMapDataOptions): MapData {
  // ── Ship counts per system (docked only) ──────────────────────
  const shipsAtSystem = useMemo(() => {
    const map = new Map<string, number>();
    for (const ship of ships) {
      if (ship.status === "docked") {
        map.set(ship.systemId, (map.get(ship.systemId) ?? 0) + 1);
      }
    }
    return map;
  }, [ships]);

  // ── Solo docked ships per system (excludes convoy members) ────
  const dockedSoloShips = useMemo(() => {
    const map = new Map<string, number>();
    for (const ship of ships) {
      if (ship.status === "docked" && !ship.convoyId) {
        map.set(ship.systemId, (map.get(ship.systemId) ?? 0) + 1);
      }
    }
    return map;
  }, [ships]);

  // ── Docked convoys per system ─────────────────────────────────
  const dockedConvoys = useMemo(() => {
    const map = new Map<string, number>();
    for (const convoy of convoys) {
      if (convoy.status === "docked") {
        map.set(convoy.systemId, (map.get(convoy.systemId) ?? 0) + 1);
      }
    }
    return map;
  }, [convoys]);

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

  // ── In-transit units (solo ships + convoys) for map markers ───
  const transitUnits = useMemo((): TransitUnit[] => {
    const nameById = new Map(universe.systems.map((s) => [s.id, s.name]));
    const sumCargo = (s: ShipState) => s.cargo.reduce((n, c) => n + c.quantity, 0);
    const out: TransitUnit[] = [];

    for (const ship of ships) {
      if (ship.status !== "in_transit" || ship.convoyId) continue;
      if (!ship.destinationSystemId || ship.departureTick === null || ship.arrivalTick === null) continue;
      out.push({
        id: ship.id,
        kind: "ship",
        name: ship.name,
        originSystemId: ship.systemId,
        destinationSystemId: ship.destinationSystemId,
        destinationName: nameById.get(ship.destinationSystemId) ?? "Unknown",
        departureTick: ship.departureTick,
        arrivalTick: ship.arrivalTick,
        speed: ship.speed,
        memberCount: 1,
        cargoUsed: sumCargo(ship),
        cargoMax: ship.cargoMax,
      });
    }

    for (const convoy of convoys) {
      if (convoy.status !== "in_transit") continue;
      if (!convoy.destinationSystemId || convoy.departureTick === null || convoy.arrivalTick === null) continue;
      const speed = convoy.members.length > 0 ? Math.min(...convoy.members.map((m) => m.speed)) : 1;
      out.push({
        id: convoy.id,
        kind: "convoy",
        name: convoy.name ?? "Convoy",
        originSystemId: convoy.systemId,
        destinationSystemId: convoy.destinationSystemId,
        destinationName: nameById.get(convoy.destinationSystemId) ?? "Unknown",
        departureTick: convoy.departureTick,
        arrivalTick: convoy.arrivalTick,
        speed,
        memberCount: convoy.members.length,
        cargoUsed: convoy.combinedCargoUsed,
        cargoMax: convoy.combinedCargoMax,
      });
    }
    return out;
  }, [ships, convoys, universe.systems]);

  // ── Events per system (from dynamic data) ────────────────────
  const eventsPerSystem = useMemo(() => {
    const map = new Map<string, SystemEventInfo[]>();
    for (const ds of dynamicSystems) {
      if (ds.eventTypeIds.length === 0) continue;
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
    if (!visibleSystemIds.has(selectedSystem.id)) return [];
    return events.filter((e) => e.systemId === selectedSystem.id);
  }, [selectedSystem, events, visibleSystemIds]);

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
      const visibility: SystemVisibility = visibleSystemIds.has(system.id)
        ? "visible"
        : "unknown";
      const price = priceHeatmap?.get(system.id) ?? null;
      const priceTint = price ? priceRampColorPixi(price.currentPrice, price.basePrice) : null;
      const priceDelta = price
        ? Math.round((price.currentPrice / price.basePrice - 1) * 100)
        : null;
      return {
        id: system.id,
        x: system.x,
        y: system.y,
        name: system.name,
        economyType: system.economyType,
        regionId: system.regionId,
        shipCount: shipsAtSystem.get(system.id) ?? 0,
        dockedShipCount: dockedSoloShips.get(system.id) ?? 0,
        dockedConvoyCount: dockedConvoys.get(system.id) ?? 0,
        isGateway: system.isGateway,
        visibility,
        navigationState: nodeNavigationStates.get(system.id),
        activeEvents: eventsPerSystem.get(system.id),
        priceTint,
        priceDelta,
      };
    });
  }, [universe.systems, shipsAtSystem, dockedSoloShips, dockedConvoys, nodeNavigationStates, eventsPerSystem, visibleSystemIds, priceHeatmap]);

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

  // ── Selected system faction name ──────────────────────────────
  const selectedFactionName = useMemo(
    () =>
      selectedSystem?.factionId
        ? universe.factions.find((f) => f.id === selectedSystem.factionId)?.name
        : undefined,
    [selectedSystem, universe.factions],
  );

  // ── Selected system visibility ───────────────────────────────
  const selectedVisibility: SystemVisibility = selectedSystem
    ? (visibleSystemIds.has(selectedSystem.id) ? "visible" : "unknown")
    : "unknown";

  // ── Trade-flow edges keyed for O(1) lookup by Pixi layer ─────
  // `fromSystemId`/`toSystemId` reflect net flow direction (not sort order),
  // so we key by canonical pair `${min}|${max}` for lookup. The renderer
  // uses the value's from/to as-is for direction.
  const flowEdges = useMemo(() => {
    const map = new Map<string, TradeFlowEdgeInfo>();
    for (const edge of tradeFlowEdges) {
      const [a, b] =
        edge.fromSystemId < edge.toSystemId
          ? [edge.fromSystemId, edge.toSystemId]
          : [edge.toSystemId, edge.fromSystemId];
      map.set(`${a}|${b}`, edge);
    }
    return map;
  }, [tradeFlowEdges]);

  return {
    systems,
    connections,
    flowEdges,
    priceHeatmap,
    shipsAtSelected,
    convoysAtSelected,
    transitUnits,
    eventsAtSelected,
    selectedGatewayTargets,
    selectedRegionName,
    selectedFactionName,
    selectedVisibility,
    allSystems: universe.systems,
  };
}
