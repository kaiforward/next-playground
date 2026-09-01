import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useMapData } from "../use-map-data";
import { buildSystemRegionMap } from "@/lib/utils/region";
import type { StarSystemInfo, UniverseData } from "@/lib/types/game";

function system(id: string, regionId: string): StarSystemInfo {
  return {
    id, name: id, economyType: "agricultural", x: 0, y: 0,
    description: "", regionId, factionId: null, isGateway: false, sunClass: "yellow",
  };
}

function universe(): UniverseData {
  const systems = [
    system("a", "region-1"),
    system("b", "region-1"),
    system("c", "region-2"),
  ];
  return {
    regions: [
      {
        id: "region-1", name: "Region 1", dominantEconomy: "agricultural",
        dominantFactionId: null, dominantGovernmentType: "frontier", x: 0, y: 0,
      },
      {
        id: "region-2", name: "Region 2", dominantEconomy: "agricultural",
        dominantFactionId: null, dominantGovernmentType: "frontier", x: 0, y: 0,
      },
    ],
    systems,
    connections: [
      // Same region, engine-flagged crossing-class (the rare priced lane) — must render crossing
      // even though its endpoints share a region, proving the flag isn't a region comparison at all.
      { id: "a-b", fromSystemId: "a", toSystemId: "b", fuelCost: 1, isCrossing: true },
      // Different regions, an ordinary band-chain link — the bug: the old region-comparison
      // heuristic would have flagged this crossing; the engine says it is not.
      { id: "b-c", fromSystemId: "b", toSystemId: "c", fuelCost: 1, isCrossing: false },
    ],
    factions: [],
  };
}

function baseOptions() {
  const u = universe();
  return {
    universe: u,
    visibleSystemIds: new Set(u.systems.map((s) => s.id)),
    logisticsEdges: [],
    selectedSystem: null,
    systemRegionMap: buildSystemRegionMap(u.systems),
    regionMap: new Map(u.regions.map((r) => [r.id, r])),
    ownership: new Map(),
    playerFactionId: null,
  };
}

describe("useMapData — connection crossing flag", () => {
  it("marks a same-region connection crossing when the engine says so", () => {
    const { result } = renderHook(() => useMapData(baseOptions()));
    const conn = result.current.connections.find((c) => c.id === "a-b");
    expect(conn?.isCrossing).toBe(true);
  });

  it("does NOT mark a cross-region band link crossing merely because its endpoints sit in different regions", () => {
    const { result } = renderHook(() => useMapData(baseOptions()));
    const conn = result.current.connections.find((c) => c.id === "b-c");
    expect(conn?.isCrossing).toBe(false);
  });
});
