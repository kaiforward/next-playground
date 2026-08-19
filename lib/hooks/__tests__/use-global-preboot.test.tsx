import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useUniverse } from "../use-universe";
import { useAtlas } from "../use-atlas";
import { useFactions } from "../use-factions";
import { useRelations } from "../use-relations";

// Judgment call (Task 7): a global slice read before the worker's first frame lands (worldVersion
// still null) returns a defined empty value for its type — never undefined, never a throw — rather
// than the old suspend-until-loaded behaviour. This pins that default for every global hook; none
// of these tests seed the store, so each reads the fresh, unseeded singleton this test file starts
// with.

describe("Global slice hooks — the pre-boot default, before any frame is applied", () => {
  it("useUniverse reads an empty universe", () => {
    const { result } = renderHook(() => useUniverse());
    expect(result.current.data).toEqual({ regions: [], systems: [], connections: [], factions: [] });
  });

  it("useAtlas reads an empty, player-less atlas", () => {
    const { result } = renderHook(() => useAtlas());
    expect(result.current.atlas).toEqual({
      meta: { mapSize: 0, systemCount: 0, seed: 0 },
      regions: [], systems: [], connections: [], factions: [], player: null,
    });
  });

  it("useFactions reads an empty faction list", () => {
    const { result } = renderHook(() => useFactions());
    expect(result.current.factions).toEqual([]);
  });

  it("useRelations reads an empty relations matrix", () => {
    const { result } = renderHook(() => useRelations());
    expect(result.current.relations).toEqual({ factions: [], pairs: [] });
  });
});
