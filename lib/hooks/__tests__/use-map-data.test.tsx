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
      { id: "a-b", fromSystemId: "a", toSystemId: "b", fuelCost: 3 },
      { id: "b-c", fromSystemId: "b", toSystemId: "c", fuelCost: 7 },
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

describe("useMapData — connection rows", () => {
  it("carries each connection's fuelCost through untouched", () => {
    const { result } = renderHook(() => useMapData(baseOptions()));
    expect(result.current.connections.find((c) => c.id === "a-b")?.fuelCost).toBe(3);
    expect(result.current.connections.find((c) => c.id === "b-c")?.fuelCost).toBe(7);
  });
});
