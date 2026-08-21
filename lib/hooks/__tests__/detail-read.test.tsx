import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSystemVitals } from "../use-system-vitals";
import { resetDetailReadWarnings } from "../detail-read";
import { seedSlices } from "./store-fixture";
import type { StarSystemInfo } from "@/lib/types/game";

// The warnedPairs latch (review finding 12) — a world replacement can re-mint an id that coincides
// with the outgoing world's (world-gen can reuse the same id sequence), so a warning already
// latched for that (family, id) pair in the old world must not permanently suppress a genuine
// missing-interest bug in the new one. `client/main.tsx` calls `resetDetailReadWarnings()` from its
// `isReplacing` true->false handler; this pins the pure behaviour that call relies on.

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

describe("resetDetailReadWarnings", () => {
  it("lets a (family, id) pair warn again after a reset, having already warned once before it", () => {
    seedSlices({
      universe: { regions: [], systems: [makeSystem("sys-replay")], connections: [], factions: [] },
      systemVitals: {},
    });

    renderHook(() => useSystemVitals("sys-replay"));
    renderHook(() => useSystemVitals("sys-replay"));
    expect(warnSpy).toHaveBeenCalledTimes(1); // latched — the second render doesn't warn again

    resetDetailReadWarnings();

    renderHook(() => useSystemVitals("sys-replay"));
    expect(warnSpy).toHaveBeenCalledTimes(2); // the reset cleared the latch — the SAME pair warns again
  });
});
