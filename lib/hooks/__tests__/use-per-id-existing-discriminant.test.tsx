import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSystemConstruction } from "../use-system-construction";
import { useSystemBuildOptions } from "../use-build-options";
import { useSystemPopulation } from "../use-system-population";
import { useSystemIndustry } from "../use-system-industry";
import { useSystemLogistics } from "../use-system-logistics";
import { useSystemSubstrate } from "../use-system-substrate";
import { seedSlices } from "./store-fixture";

// The per-system hooks whose data type already carries a "nothing to show" arm reuse that arm for
// an absent systemId, rather than adding a new discriminant — see each hook's NOT_FOUND docstring.
// This suite pins the reused fallback for every one of them.

describe("Per-system hooks — an absent systemId reuses the type's own fallback arm", () => {
  it("useSystemConstruction: { visibility: \"hidden\" }", () => {
    seedSlices({ systemConstruction: {} });
    expect(renderHook(() => useSystemConstruction("sys-none")).result.current).toEqual({
      visibility: "hidden",
    });
  });

  it("useSystemBuildOptions: { mode: \"none\" }", () => {
    seedSlices({ systemBuildOptions: {} });
    expect(renderHook(() => useSystemBuildOptions("sys-none")).result.current).toEqual({
      mode: "none",
    });
  });

  it("useSystemPopulation / useSystemIndustry / useSystemLogistics / useSystemSubstrate: { visibility: \"unknown\" }", () => {
    seedSlices({ systemPopulation: {}, systemIndustry: {}, systemLogistics: {}, systemSubstrate: {} });
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
  });
});
