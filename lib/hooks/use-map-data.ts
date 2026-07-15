"use client";

import { useMemo } from "react";
import type {
  UniverseData,
  StarSystemInfo,
  EconomyType,
  SunClass,
  SystemVisibility,
} from "@/lib/types/game";
import type { TradeFlowEdgeInfo } from "@/lib/types/api";

// ── Types ───────────────────────────────────────────────────────

export interface SystemNodeData {
  id: string;
  x: number;
  y: number;
  name: string;
  economyType: EconomyType;
  /** Star spectral class — colours the map's star-type dot. */
  sunClass: SunClass;
  /** True when the system is developed (control === 'developed'). Undeveloped systems render
   *  as a hollow marker — labelled potential, not owned. */
  developed: boolean;
  regionId: string;
  isGateway: boolean;
  visibility: SystemVisibility;
}

export interface ConnectionData {
  id: string;
  fromId: string;
  toId: string;
  fuelCost: number;
  isGateway: boolean;
}

export interface MapData {
  systems: SystemNodeData[];
  connections: ConnectionData[];
  /**
   * Directed-logistics edges keyed by canonical edge id `${fromId}|${toId}`
   * (sorted). Empty when the Logistics overlay is off — the Pixi layer renders nothing.
   */
  logisticsFlowEdges: Map<string, TradeFlowEdgeInfo>;
  // Detail panel data
  selectedGatewayTargets: { regionId: string; regionName: string }[];
  selectedRegionName: string | undefined;
  selectedFactionName: string | undefined;
  selectedVisibility: SystemVisibility;
  allSystems: StarSystemInfo[];
}

// ── Options ─────────────────────────────────────────────────────

interface UseMapDataOptions {
  universe: UniverseData;
  visibleSystemIds: Set<string>;
  logisticsEdges: TradeFlowEdgeInfo[];
  selectedSystem: StarSystemInfo | null;
  systemRegionMap: Map<string, string>;
  regionMap: Map<string, { id: string; name: string }>;
}

// ── Helpers ─────────────────────────────────────────────────────

/** Key edges by canonical (sorted) endpoint pair for O(1) Pixi lookup. */
function keyByCanonicalPair(
  edges: TradeFlowEdgeInfo[],
): Map<string, TradeFlowEdgeInfo> {
  const map = new Map<string, TradeFlowEdgeInfo>();
  for (const edge of edges) {
    const [a, b] =
      edge.fromSystemId < edge.toSystemId
        ? [edge.fromSystemId, edge.toSystemId]
        : [edge.toSystemId, edge.fromSystemId];
    map.set(`${a}|${b}`, edge);
  }
  return map;
}

// ── Hook ────────────────────────────────────────────────────────

export function useMapData({
  universe,
  visibleSystemIds,
  logisticsEdges,
  selectedSystem,
  systemRegionMap,
  regionMap,
}: UseMapDataOptions): MapData {
  // ── System nodes (all systems) ────────────────────────────────
  const systems = useMemo((): SystemNodeData[] => {
    return universe.systems.map((system) => {
      const visibility: SystemVisibility = visibleSystemIds.has(system.id)
        ? "visible"
        : "unknown";
      return {
        id: system.id,
        x: system.x,
        y: system.y,
        name: system.name,
        economyType: system.economyType,
        sunClass: system.sunClass,
        developed: system.developed ?? true,
        regionId: system.regionId,
        isGateway: system.isGateway,
        visibility,
      };
    });
  }, [universe.systems, visibleSystemIds]);

  // ── Connections (all, deduplicated) ───────────────────────────
  const connections = useMemo((): ConnectionData[] => {
    const seen = new Set<string>();
    const result: ConnectionData[] = [];

    for (const conn of universe.connections) {
      const pairKey = [conn.fromSystemId, conn.toSystemId].sort().join("--");
      if (seen.has(pairKey)) continue;
      seen.add(pairKey);

      result.push({
        id: conn.id,
        fromId: conn.fromSystemId,
        toId: conn.toSystemId,
        fuelCost: conn.fuelCost,
        isGateway: systemRegionMap.get(conn.fromSystemId) !== systemRegionMap.get(conn.toSystemId),
      });
    }

    return result;
  }, [universe.connections, systemRegionMap]);

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

  // ── Trade-flow edges keyed for O(1) lookup by the Pixi layers ─────
  // `fromSystemId`/`toSystemId` reflect net flow direction (not sort order),
  // so we key by canonical pair `${min}|${max}`. The renderer uses each value's
  // from/to as-is for direction.
  const logisticsFlowEdges = useMemo(() => keyByCanonicalPair(logisticsEdges), [logisticsEdges]);

  return {
    systems,
    connections,
    logisticsFlowEdges,
    selectedGatewayTargets,
    selectedRegionName,
    selectedFactionName,
    selectedVisibility,
    allSystems: universe.systems,
  };
}
