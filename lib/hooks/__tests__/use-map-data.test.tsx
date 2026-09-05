import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useMapData, type UseMapDataOptions } from "../use-map-data";
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

function baseOptions(): UseMapDataOptions {
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
    laneStates: [],
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

  it("joins investorFactionId by laneKey, reading null when the lane state is missing", () => {
    const options = baseOptions();
    options.laneStates = [
      {
        key: "a|b",
        aId: "a",
        bId: "b",
        level: 1,
        capacity: 10,
        bookedLoad: 0,
        blockedVolume: 0,
        inFlight: 0,
        investorFactionId: "faction-1",
        openUpgradeLevels: 0,
      },
    ];
    const { result } = renderHook(() => useMapData(options));
    expect(result.current.connections.find((c) => c.id === "a-b")?.investorFactionId).toBe(
      "faction-1",
    );
    // b-c has no lane state at all — investor reads null, not undefined.
    expect(result.current.connections.find((c) => c.id === "b-c")?.investorFactionId).toBeNull();
  });

  it("derives each connection's band from its own load/blocked, agreeing with laneBand", () => {
    const options = baseOptions();
    options.laneStates = [
      {
        key: "a|b",
        aId: "a",
        bId: "b",
        level: 0,
        capacity: 10,
        bookedLoad: 0,
        blockedVolume: 5,
        inFlight: 0,
        investorFactionId: null,
        openUpgradeLevels: 0,
      },
      {
        key: "b|c",
        aId: "b",
        bId: "c",
        level: 0,
        capacity: 10,
        bookedLoad: 8,
        blockedVolume: 0,
        inFlight: 0,
        investorFactionId: null,
        openUpgradeLevels: 0,
      },
    ];
    const { result } = renderHook(() => useMapData(options));
    const ab = result.current.connections.find((c) => c.id === "a-b");
    const bc = result.current.connections.find((c) => c.id === "b-c");
    expect(ab).toMatchObject({ blocked: true, band: "congested" });
    expect(bc).toMatchObject({ load: 0.8, band: "busy" });
  });
});

describe("useMapData — laneBandBySystem", () => {
  function hubUniverse(): UniverseData {
    const systems = [
      system("hub", "region-1"),
      system("fine-1", "region-1"),
      system("fine-2", "region-1"),
      system("fine-3", "region-1"),
      system("congested-partner", "region-1"),
      system("isolated", "region-1"),
    ];
    return {
      regions: [
        {
          id: "region-1", name: "Region 1", dominantEconomy: "agricultural",
          dominantFactionId: null, dominantGovernmentType: "frontier", x: 0, y: 0,
        },
      ],
      systems,
      connections: [
        { id: "hub-fine1", fromSystemId: "hub", toSystemId: "fine-1", fuelCost: 1 },
        { id: "hub-fine2", fromSystemId: "hub", toSystemId: "fine-2", fuelCost: 1 },
        { id: "hub-fine3", fromSystemId: "hub", toSystemId: "fine-3", fuelCost: 1 },
        { id: "hub-congested", fromSystemId: "hub", toSystemId: "congested-partner", fuelCost: 1 },
      ],
      factions: [],
    };
  }

  function hubOptions(): UseMapDataOptions {
    const u = hubUniverse();
    return {
      universe: u,
      visibleSystemIds: new Set(u.systems.map((s) => s.id)),
      logisticsEdges: [],
      selectedSystem: null,
      systemRegionMap: buildSystemRegionMap(u.systems),
      regionMap: new Map(u.regions.map((r) => [r.id, r])),
      ownership: new Map(),
      playerFactionId: null,
      laneStates: [
        {
          key: "congested-partner|hub",
          aId: "congested-partner",
          bId: "hub",
          level: 0,
          capacity: 10,
          bookedLoad: 0,
          blockedVolume: 1,
          inFlight: 0,
          investorFactionId: null,
          openUpgradeLevels: 0,
        },
      ],
    };
  }

  it("reads congested for a system touching one congested lane among three fine ones", () => {
    const { result } = renderHook(() => useMapData(hubOptions()));
    expect(result.current.laneBandBySystem.get("hub")).toBe("congested");
  });

  it("reads fine for a system touching only fine lanes", () => {
    const { result } = renderHook(() => useMapData(hubOptions()));
    expect(result.current.laneBandBySystem.get("fine-1")).toBe("fine");
  });

  it("omits a system with no connection", () => {
    const { result } = renderHook(() => useMapData(hubOptions()));
    expect(result.current.laneBandBySystem.has("isolated")).toBe(false);
  });

  it("is empty when built from an empty connection list", () => {
    const options = hubOptions();
    options.universe = { ...options.universe, connections: [] };
    const { result } = renderHook(() => useMapData(options));
    expect(result.current.laneBandBySystem.size).toBe(0);
    // Vacuity check: the "hub reads congested" assertion must actually fail against this
    // empty-connections build — otherwise the congested test above would pass vacuously.
    expect(result.current.laneBandBySystem.get("hub")).not.toBe("congested");
  });
});
