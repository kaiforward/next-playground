import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSystemVitals } from "../use-system-vitals";
import { seedSlices } from "./store-fixture";
import type { SystemVitalsData } from "@/lib/types/api";

const VISIBLE: SystemVitalsData = {
  visibility: "visible",
  stability: { pct: 80, unrest: 0.2 },
  development: { points: 10, potential: 20, pct: 50 },
  population: { headcount: 100, composition: { unskilled: 100, technicians: 0, engineers: 0, unemployed: 0 } },
  provision: { assessed: false },
};

describe("useSystemVitals — per-id absent-id handling", () => {
  it("reads the store's entry for a known system id", () => {
    seedSlices({ systemVitals: { "sys-known": VISIBLE } });
    const { result } = renderHook(() => useSystemVitals("sys-known"));
    expect(result.current).toEqual(VISIBLE);
  });

  it("returns a discriminated not-found reading for an id absent from the slice, never throws", () => {
    seedSlices({ systemVitals: { "sys-known": VISIBLE } });
    expect(() => renderHook(() => useSystemVitals("sys-does-not-exist"))).not.toThrow();
    const { result } = renderHook(() => useSystemVitals("sys-does-not-exist"));
    expect(result.current).toEqual({ visibility: "unknown" });
  });
});
