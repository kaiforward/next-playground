import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useLanes } from "../use-lanes";
import { seedSlices } from "./store-fixture";

describe("useLanes", () => {
  it("reads an empty array before any frame carries a lanes slice (pre-boot / lane-less world)", () => {
    // No seedSlices call in this test — the fresh, unseeded singleton this test file starts with.
    const { result } = renderHook(() => useLanes());
    expect(result.current).toEqual([]);
  });

  it("reads the lanes slice once a frame carries it", () => {
    seedSlices({
      lanes: [
        {
          key: "a|b",
          aId: "a",
          bId: "b",
          level: 1,
          capacity: 20,
          bookedLoad: 5,
          blockedVolume: 0,
          inFlight: 2,
          investorFactionId: "f1",
          openUpgradeLevels: 0,
        },
      ],
    });
    const { result } = renderHook(() => useLanes());
    expect(result.current).toHaveLength(1);
    expect(result.current[0].key).toBe("a|b");
  });
});
