import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useMarket } from "../use-market";
import { useMarketComparison } from "../use-market-comparison";
import { useFactionVitals } from "../use-faction-vitals";
import { useFactionConstruction } from "../use-faction-construction";
import { useSystemCadence } from "../use-system-cadence";
import { seedSlices } from "./store-fixture";

// These four hooks' return types carry no discriminant of their own (unlike the per-system reads)
// and their only callers dereference fields directly — the Task 7 judgment call (see each hook's
// NOT_FOUND docstring) is a benign zero/empty default rather than a new union member. This suite
// pins that default and that it never throws, for a systemId/factionId absent from every slice.

describe("useMarket — absent systemId reads as an empty market, never throws", () => {
  it("returns no entries and the systemId as a stationId fallback", () => {
    seedSlices({ market: {} });
    expect(() => renderHook(() => useMarket("sys-none"))).not.toThrow();
    const { result } = renderHook(() => useMarket("sys-none"));
    expect(result.current).toEqual({ market: [], stationId: "sys-none" });
  });
});

describe("useMarketComparison — absent goodId reads as no comparison rows, never throws", () => {
  it("returns the goodId with an empty entries list", () => {
    seedSlices({ marketComparison: {} });
    const { result } = renderHook(() => useMarketComparison("nonexistent-good"));
    expect(result.current).toEqual({ goodId: "nonexistent-good", entries: [] });
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
      buildSystems: [], colonies: [], orderedCount: 0,
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
