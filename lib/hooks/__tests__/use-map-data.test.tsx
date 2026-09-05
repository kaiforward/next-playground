import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useMapData } from "../use-map-data";
import { buildSystemRegionMap } from "@/lib/utils/region";
import type { StarSystemInfo, UniverseData } from "@/lib/types/game";
import type { LaneStateRow } from "@/lib/types/api";

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
    laneStates: [] as LaneStateRow[],
  };
}

describe("useMapData — connection rows", () => {
  it("carries each connection's fuelCost through untouched", () => {
    const { result } = renderHook(() => useMapData(baseOptions()));
    expect(result.current.connections.find((c) => c.id === "a-b")?.fuelCost).toBe(3);
    expect(result.current.connections.find((c) => c.id === "b-c")?.fuelCost).toBe(7);
  });

  it("defaults level/load/blocked to inert values when no lane state exists for the pair", () => {
    const { result } = renderHook(() => useMapData(baseOptions()));
    const ab = result.current.connections.find((c) => c.id === "a-b");
    expect(ab).toMatchObject({ level: 0, load: 0, blocked: false, laneKey: "a|b" });
  });

  it("joins lane state onto the matching connection by laneKey", () => {
    const options = baseOptions();
    options.laneStates = [
      {
        key: "a|b",
        aId: "a",
        bId: "b",
        level: 2,
        capacity: 20,
        bookedLoad: 10,
        blockedVolume: 0,
        inFlight: 0,
        investorFactionId: null,
        openUpgradeLevels: 0,
      },
    ];
    const { result } = renderHook(() => useMapData(options));
    const ab = result.current.connections.find((c) => c.id === "a-b");
    expect(ab).toMatchObject({ level: 2, load: 0.5, blocked: false });
    // The untouched pair keeps its inert defaults.
    const bc = result.current.connections.find((c) => c.id === "b-c");
    expect(bc).toMatchObject({ level: 0, load: 0, blocked: false });
  });

  it("reads blocked when blockedVolume > 0, regardless of load", () => {
    const options = baseOptions();
    options.laneStates = [
      {
        key: "a|b",
        aId: "a",
        bId: "b",
        level: 0,
        capacity: 10,
        bookedLoad: 0,
        blockedVolume: 3,
        inFlight: 0,
        investorFactionId: null,
        openUpgradeLevels: 0,
      },
    ];
    const { result } = renderHook(() => useMapData(options));
    expect(result.current.connections.find((c) => c.id === "a-b")).toMatchObject({ blocked: true });
  });
});
