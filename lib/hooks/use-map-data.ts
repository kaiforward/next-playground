"use client";

import { useMemo } from "react";
import type {
  UniverseData,
  StarSystemInfo,
  EconomyType,
  SunClass,
  SystemVisibility,
} from "@/lib/types/game";
import type { TradeFlowEdgeInfo, LaneStateRow } from "@/lib/types/api";
import { settlementMarkFor, type SettlementMark } from "@/lib/types/map";
import type { SystemOwnership } from "@/lib/hooks/use-ownership";
import { laneKey as buildLaneKey } from "@/lib/engine/lanes";
import { laneBand, worstLaneBand, type LaneBand } from "@/components/map/pixi/objects/lane-band";

// ── Types ───────────────────────────────────────────────────────

export interface SystemNodeData {
  id: string;
  x: number;
  y: number;
  name: string;
  economyType: EconomyType;
  /** Star spectral class — colours the map's star-type dot. */
  sunClass: SunClass;
  /** Settlement mark at the star's shoulder (player systems only) — see `settlementMarkFor`. */
  settlementMark: SettlementMark | null;
  regionId: string;
  isGateway: boolean;
  visibility: SystemVisibility;
}

export interface ConnectionData {
  id: string;
  fromId: string;
  toId: string;
  fuelCost: number;
  /** Undirected lane identity (`lib/engine/lanes.ts`'s `laneKey`) — derived from the connection
   *  itself, so it is present whether or not the `lanes` slice has landed yet. Feeds both the
   *  lane-layer style and the lane-hit-test/selection route key. */
  laneKey: string;
  /** Invested upgrade level. The fallbacks on `level`, `load`, `blocked`, `investorFactionId` and
   *  `band` cover exactly ONE state: a PRE-BOOT frame, where the `lanes` slice has not landed but
   *  the atlas's connections have. A live world always carries one lane row per connection
   *  (generation mints them, the save version refuses anything older), so a connection with no lane
   *  row at runtime is an invariant break, not a supported "lane state missing" case. */
  level: number;
  /** `bookedLoad / capacity`, clamped to [0, 1] at the style helper — 0 pre-boot (see `level`). */
  load: number;
  /** This run's `blockedVolume > 0` — false pre-boot (see `level`). */
  blocked: boolean;
  /** The faction holding BOTH endpoints — the one that may invest in the lane and pays its upkeep
   *  (`laneInvestor`, `lib/engine/lanes.ts`); null when an endpoint is unclaimed or the two ends are
   *  split between factions, and null pre-boot (see `level`). */
  investorFactionId: string | null;
  /** `laneBand({ load, blocked })` — "fine" pre-boot (see `level`). */
  band: LaneBand;
}

export interface MapData {
  systems: SystemNodeData[];
  connections: ConnectionData[];
  /** Worst `LaneBand` across each system's connections, keyed by system id — absent for a system
   *  with no connection. Feeds the Lanes-mode choropleth (docs/active/engineering/map-rendering.md → Lane layer). */
  laneBandBySystem: Map<string, LaneBand>;
  /**
   * Directed-logistics edges keyed by `${laneKey}|${fromSystemId}` — one entry per lane per
   * direction, never per canonical system pair (a lane can carry traffic both ways at once). Empty
   * outside the Lanes map mode — the Pixi layer renders nothing.
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

export interface UseMapDataOptions {
  universe: UniverseData;
  visibleSystemIds: Set<string>;
  logisticsEdges: TradeFlowEdgeInfo[];
  selectedSystem: StarSystemInfo | null;
  systemRegionMap: Map<string, string>;
  regionMap: Map<string, { id: string; name: string }>;
  /** Live per-system ownership — feeds the settlement marks. */
  ownership: Map<string, SystemOwnership>;
  playerFactionId: string | null;
  /** Every lane's live state (`useLanes()`) — joined onto `ConnectionData` by `laneKey`. */
  laneStates: LaneStateRow[];
}

// ── Helpers ─────────────────────────────────────────────────────

/**
 * Key edges by (lane, direction) for O(1) Pixi lookup — NOT by canonical endpoint pair: a lane can
 * carry in-flight volume in both directions at once (two `TradeFlowEdgeInfo` rows sharing one
 * `laneKey`), and keying by the sorted pair alone would silently collide one into the other.
 */
function keyByLaneAndDirection(
  edges: TradeFlowEdgeInfo[],
): Map<string, TradeFlowEdgeInfo> {
  const map = new Map<string, TradeFlowEdgeInfo>();
  for (const edge of edges) {
    map.set(`${edge.laneKey}|${edge.fromSystemId}`, edge);
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
  ownership,
  playerFactionId,
  laneStates,
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
        settlementMark: settlementMarkFor(ownership.get(system.id), playerFactionId),
        regionId: system.regionId,
        isGateway: system.isGateway,
        visibility,
      };
    });
  }, [universe.systems, visibleSystemIds, ownership, playerFactionId]);

  // ── Lane state, keyed for the connections join ─────────────────
  const laneStateByKey = useMemo(() => {
    const map = new Map<string, LaneStateRow>();
    for (const lane of laneStates) map.set(lane.key, lane);
    return map;
  }, [laneStates]);

  // ── Connections (all, deduplicated) ───────────────────────────
  const connections = useMemo((): ConnectionData[] => {
    const seen = new Set<string>();
    const result: ConnectionData[] = [];

    for (const conn of universe.connections) {
      const pairKey = [conn.fromSystemId, conn.toSystemId].sort().join("--");
      if (seen.has(pairKey)) continue;
      seen.add(pairKey);

      const key = buildLaneKey(conn.fromSystemId, conn.toSystemId);
      const lane = laneStateByKey.get(key);
      const load = lane && lane.capacity > 0 ? lane.bookedLoad / lane.capacity : 0;
      const blocked = (lane?.blockedVolume ?? 0) > 0;
      result.push({
        id: conn.id,
        fromId: conn.fromSystemId,
        toId: conn.toSystemId,
        fuelCost: conn.fuelCost,
        laneKey: key,
        level: lane?.level ?? 0,
        load,
        blocked,
        investorFactionId: lane?.investorFactionId ?? null,
        band: laneBand({ load, blocked }),
      });
    }

    return result;
  }, [universe.connections, laneStateByKey]);

  // ── Worst lane band per system ────────────────────────────────
  const laneBandBySystem = useMemo(() => {
    const bandsBySystem = new Map<string, LaneBand[]>();
    for (const conn of connections) {
      for (const systemId of [conn.fromId, conn.toId]) {
        const bands = bandsBySystem.get(systemId);
        if (bands) bands.push(conn.band);
        else bandsBySystem.set(systemId, [conn.band]);
      }
    }
    const result = new Map<string, LaneBand>();
    for (const [systemId, bands] of bandsBySystem) {
      const worst = worstLaneBand(bands);
      if (worst !== null) result.set(systemId, worst);
    }
    return result;
  }, [connections]);

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
  // One entry per (lane, direction): the key carries the lane's canonical pair plus the hop's
  // origin, so a lane carrying freight both ways yields two entries.
  const logisticsFlowEdges = useMemo(() => keyByLaneAndDirection(logisticsEdges), [logisticsEdges]);

  return {
    systems,
    connections,
    laneBandBySystem,
    logisticsFlowEdges,
    selectedGatewayTargets,
    selectedRegionName,
    selectedFactionName,
    selectedVisibility,
    allSystems: universe.systems,
  };
}
