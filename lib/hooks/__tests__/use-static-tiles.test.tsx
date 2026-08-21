import { describe, it, expect } from "vitest";
import { act } from "@testing-library/react";
import { renderHook } from "@testing-library/react";
import { useStaticTiles } from "../use-static-tiles";
import { seedSlices } from "./store-fixture";
import type { StarSystemInfo } from "@/lib/types/game";

function system(id: string, x: number, y: number): StarSystemInfo {
  return {
    id, name: `System ${id}`, economyType: "agricultural", x, y,
    description: "", regionId: "r1", factionId: null, isGateway: false, sunClass: "yellow",
  };
}

const MAP_SIZE = 100;

describe("useStaticTiles — a client-side filter of the universe slice, not a fetch", () => {
  it("carries no systems until a viewport activates it", () => {
    seedSlices({ universe: { regions: [], systems: [system("s1", 5, 5)], connections: [], factions: [] } });
    const { result } = renderHook(() => useStaticTiles(MAP_SIZE));
    expect(result.current.systems).toEqual([]);
    expect(result.current.active).toBe(false);
  });

  it("returns systems inside the active viewport's tiles, filtered from the store's universe slice", () => {
    seedSlices({
      universe: {
        regions: [],
        systems: [system("near", 5, 5), system("far", 90, 90)],
        connections: [],
        factions: [],
      },
    });
    const { result } = renderHook(() => useStaticTiles(MAP_SIZE));

    act(() => {
      result.current.onViewportChange({ minX: 0, minY: 0, maxX: 20, maxY: 20 }, 0.5);
    });

    expect(result.current.active).toBe(true);
    expect(result.current.systems.map((s) => s.id)).toEqual(["near"]);
  });
});
