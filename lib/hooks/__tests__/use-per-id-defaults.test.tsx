import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useMarket } from "../use-market";
import { useMarketComparison } from "../use-market-comparison";
import { useFactionVitals } from "../use-faction-vitals";
import { useFactionConstruction } from "../use-faction-construction";
import { useSystemCadence } from "../use-system-cadence";
import { seedSlices } from "./store-fixture";
import type { StarSystemInfo } from "@/lib/types/game";

// These four hooks' return types carry no discriminant of their own (unlike the per-system reads)
// and their only callers dereference fields directly — the judgment call (see each hook's
// NOT_FOUND docstring) is a benign zero/empty default rather than a new union member. This suite
// pins that default and that it never throws, for a systemId/factionId absent from every slice.
//
// `useMarket`/`useMarketComparison` are interest-keyed (frame-architecture spec): their absent-id
// fallback now carries TWO distinct meanings — the id never existed, or it exists but isn't in the
// current interest set yet (`lib/hooks/detail-read.ts`). This suite pins both as separate cases for
// those two hooks. `useFactionVitals`/`useFactionConstruction` stay pushed-coarse (every faction
// slice is always fully populated for the world's real factions), so only "never existed" applies
// to them — no second case to add.

function makeSystem(id: string): StarSystemInfo {
  return {
    id,
    name: id,
    economyType: "agricultural",
    x: 0,
    y: 0,
    description: "",
    regionId: "",
    factionId: null,
    isGateway: false,
    developed: true,
    sunClass: "yellow",
  };
}

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
});

describe("useMarket — absent systemId reads as an empty market, never throws", () => {
  it("never existed: not in universe — no entries, systemId as stationId fallback, no warning", () => {
    seedSlices({ universe: { regions: [], systems: [], connections: [], factions: [] }, market: {} });
    expect(() => renderHook(() => useMarket("sys-none"))).not.toThrow();
    const { result } = renderHook(() => useMarket("sys-none"));
    expect(result.current).toEqual({ market: [], stationId: "sys-none" });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("exists, not subscribed: id is in universe but the market slice has no entry — same fallback, warns once", () => {
    seedSlices({
      universe: { regions: [], systems: [makeSystem("sys-exists-market")], connections: [], factions: [] },
      market: {},
    });
    const { result } = renderHook(() => useMarket("sys-exists-market"));
    expect(result.current).toEqual({ market: [], stationId: "sys-exists-market" });
    renderHook(() => useMarket("sys-exists-market"));
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain("sys-exists-market");
  });
});

describe("useMarketComparison — absent goodId reads as no comparison rows, never throws", () => {
  it("never existed: goodId outside the goods catalog — empty entries, no warning", () => {
    seedSlices({ marketComparison: {} });
    const { result } = renderHook(() => useMarketComparison("nonexistent-good"));
    expect(result.current).toEqual({ goodId: "nonexistent-good", entries: [] });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("exists, not subscribed: goodId is in the goods catalog but the slice has no entry — same fallback, warns once", () => {
    seedSlices({ marketComparison: {} });
    const { result } = renderHook(() => useMarketComparison("water"));
    expect(result.current).toEqual({ goodId: "water", entries: [] });
    renderHook(() => useMarketComparison("water"));
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain("water");
  });
});

describe("useFactionVitals — absent factionId reads as all-zero vitals, never throws", () => {
  it("returns the zero-valued default", () => {
    seedSlices({ factionVitals: {} });
    const { result } = renderHook(() => useFactionVitals("f-none"));
    expect(result.current).toEqual({
      territorySize: 0, activeSystemCount: 0, population: 0, stabilityPct: 0,
      developmentPoints: 0, developmentPotential: 0, developmentPct: 0,
    });
  });
});

describe("useFactionConstruction — absent factionId reads as an empty construction summary", () => {
  it("returns the zero-valued default", () => {
    seedSlices({ factionConstruction: {} });
    const { result } = renderHook(() => useFactionConstruction("f-none"));
    expect(result.current).toEqual({
      factionId: "", pool: 0, poolBase: 0, poolCentres: 0, automation: null,
      buildSystems: [], colonies: [], lanes: [], orderedCount: 0,
    });
  });
});

describe("useSystemCadence — the literal constant, for any systemId", () => {
  it("returns resolutionGroup 0 unconditionally", () => {
    expect(renderHook(() => useSystemCadence("any-system-id")).result.current).toEqual({
      resolutionGroup: 0,
    });
    expect(renderHook(() => useSystemCadence("literally-anything")).result.current).toEqual({
      resolutionGroup: 0,
    });
  });
});
