import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSystemConstruction } from "../use-system-construction";
import { useSystemBuildOptions } from "../use-build-options";
import { useSystemPopulation } from "../use-system-population";
import { useSystemIndustry } from "../use-system-industry";
import { useSystemLogistics } from "../use-system-logistics";
import { useSystemSubstrate } from "../use-system-substrate";
import { useSystemVitals } from "../use-system-vitals";
import { seedSlices } from "./store-fixture";
import type { StarSystemInfo } from "@/lib/types/game";

// The per-system hooks whose data type already carries a "nothing to show" arm reuse that arm for
// an absent systemId, rather than adding a new discriminant — see each hook's NOT_FOUND docstring.
// This suite pins the reused fallback for every one of them, for BOTH reasons an entry can be
// absent (frame-architecture spec, "Store and signature consequences"): the systemId never existed
// in the galaxy, or it exists but isn't in the current interest set yet
// (`lib/hooks/detail-read.ts`) — the "never existed" case logs nothing; "exists, not subscribed"
// fires the dev warning exactly once per (family, id).

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

const EMPTY_UNIVERSE = { regions: [], systems: [], connections: [], factions: [] };

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
});

describe("Per-system hooks — never existed: absent systemId not in universe reuses the type's own fallback, no warning", () => {
  it("useSystemConstruction: { visibility: \"hidden\" }", () => {
    seedSlices({ universe: EMPTY_UNIVERSE, systemConstruction: {} });
    expect(renderHook(() => useSystemConstruction("sys-none")).result.current).toEqual({
      visibility: "hidden",
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("useSystemBuildOptions: { mode: \"none\" }", () => {
    seedSlices({ universe: EMPTY_UNIVERSE, systemBuildOptions: {} });
    expect(renderHook(() => useSystemBuildOptions("sys-none")).result.current).toEqual({
      mode: "none",
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("useSystemPopulation / useSystemIndustry / useSystemLogistics / useSystemSubstrate / useSystemVitals: { visibility: \"unknown\" }", () => {
    seedSlices({
      universe: EMPTY_UNIVERSE,
      systemPopulation: {},
      systemIndustry: {},
      systemLogistics: {},
      systemSubstrate: {},
      systemVitals: {},
    });
    expect(renderHook(() => useSystemPopulation("sys-none")).result.current).toEqual({
      visibility: "unknown",
    });
    expect(renderHook(() => useSystemIndustry("sys-none")).result.current).toEqual({
      visibility: "unknown",
    });
    expect(renderHook(() => useSystemLogistics("sys-none")).result.current).toEqual({
      visibility: "unknown",
    });
    expect(renderHook(() => useSystemSubstrate("sys-none")).result.current).toEqual({
      visibility: "unknown",
    });
    expect(renderHook(() => useSystemVitals("sys-none")).result.current).toEqual({
      visibility: "unknown",
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe("Per-system hooks — exists, not subscribed: systemId is in universe but the detail slice is empty", () => {
  it("useSystemConstruction: same fallback, warns once per id", () => {
    seedSlices({
      universe: { ...EMPTY_UNIVERSE, systems: [makeSystem("sys-exists-construction")] },
      systemConstruction: {},
    });
    expect(renderHook(() => useSystemConstruction("sys-exists-construction")).result.current).toEqual({
      visibility: "hidden",
    });
    renderHook(() => useSystemConstruction("sys-exists-construction"));
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain("sys-exists-construction");
  });

  it("useSystemBuildOptions: same fallback, warns once per id", () => {
    seedSlices({
      universe: { ...EMPTY_UNIVERSE, systems: [makeSystem("sys-exists-build")] },
      systemBuildOptions: {},
    });
    expect(renderHook(() => useSystemBuildOptions("sys-exists-build")).result.current).toEqual({
      mode: "none",
    });
    renderHook(() => useSystemBuildOptions("sys-exists-build"));
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain("sys-exists-build");
  });

  it("useSystemPopulation / useSystemIndustry / useSystemLogistics / useSystemSubstrate / useSystemVitals: same fallback, each warns once per id", () => {
    seedSlices({
      universe: {
        ...EMPTY_UNIVERSE,
        systems: [
          makeSystem("sys-exists-population"),
          makeSystem("sys-exists-industry"),
          makeSystem("sys-exists-logistics"),
          makeSystem("sys-exists-substrate"),
          makeSystem("sys-exists-vitals"),
        ],
      },
      systemPopulation: {},
      systemIndustry: {},
      systemLogistics: {},
      systemSubstrate: {},
      systemVitals: {},
    });

    expect(renderHook(() => useSystemPopulation("sys-exists-population")).result.current).toEqual({
      visibility: "unknown",
    });
    expect(renderHook(() => useSystemIndustry("sys-exists-industry")).result.current).toEqual({
      visibility: "unknown",
    });
    expect(renderHook(() => useSystemLogistics("sys-exists-logistics")).result.current).toEqual({
      visibility: "unknown",
    });
    expect(renderHook(() => useSystemSubstrate("sys-exists-substrate")).result.current).toEqual({
      visibility: "unknown",
    });
    expect(renderHook(() => useSystemVitals("sys-exists-vitals")).result.current).toEqual({
      visibility: "unknown",
    });

    // Re-render each — the warning must not repeat for an id already warned about.
    renderHook(() => useSystemPopulation("sys-exists-population"));
    renderHook(() => useSystemIndustry("sys-exists-industry"));
    renderHook(() => useSystemLogistics("sys-exists-logistics"));
    renderHook(() => useSystemSubstrate("sys-exists-substrate"));
    renderHook(() => useSystemVitals("sys-exists-vitals"));

    expect(warnSpy).toHaveBeenCalledTimes(5);
  });
});
