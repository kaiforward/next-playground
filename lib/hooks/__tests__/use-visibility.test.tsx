import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useVisibility } from "../use-visibility";
import { seedSlices } from "./store-fixture";

describe("useVisibility — all-visible semantics, pre-boot default", () => {
  it("returns an empty set before the first frame lands", () => {
    const { result } = renderHook(() => useVisibility());
    expect(result.current.visibleSystemIds.size).toBe(0);
  });

  it("wraps every system id the visibility slice carries — every system in the world, per buildStateFrame", () => {
    seedSlices({ visibility: { systemIds: ["sys-a", "sys-b", "sys-c"] } });
    const { result } = renderHook(() => useVisibility());
    expect(result.current.visibleSystemIds).toEqual(new Set(["sys-a", "sys-b", "sys-c"]));
  });
});
