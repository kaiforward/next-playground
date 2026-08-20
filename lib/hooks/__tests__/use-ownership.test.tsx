import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useOwnership } from "../use-ownership";
import { useGameSlice } from "@/lib/store/use-game-store";
import { seedSlices } from "./store-fixture";

// Proves 1 (client-runtime build plan Task 8): ownership keeps object identity across no-change
// ticks — the Pixi territory/marker zero-rebuild bar at hook level (census C3). The store's
// `replaceEqualDeep` merge already keeps the SLICE's array reference stable across a deep-equal
// frame; what this pins is that `useOwnership`'s own `useMemo` doesn't defeat that by rebuilding the
// derived Map on every render regardless.

describe("useOwnership — identity stability across no-change ticks (census C3)", () => {
  it("keeps the same Map reference when an UNRELATED slice change re-renders the component", () => {
    // A frame carrying only `ownership` (unchanged content, fresh array reference — as the tick
    // adapters hand back every tick) would not even re-render this hook's component at all: the
    // store's own `replaceEqualDeep` merge keeps the SLICE reference stable, and `useGameSlice`'s
    // Zustand selector equality (Object.is) means an unchanged selected value never re-renders its
    // subscriber in the first place — that guarantee lives one layer below this hook
    // (`lib/store/game-store.ts`, `lib/store/__tests__/game-store.test.ts`), not here.
    //
    // What THIS hook is responsible for is the layer above that: when the component re-renders for
    // an UNRELATED reason (a different slice changed), `useOwnership` must not rebuild the derived
    // Map just because it was called again — its own `useMemo` must still recognise the ownership
    // slice's `entries` reference as unchanged.
    seedSlices({
      ownership: [{ systemId: "sys-1", factionId: "f1", developed: true, forming: false }],
    });
    const { result } = renderHook(() => ({
      ownership: useOwnership(),
      // Read an unrelated slice too, so the wrapping component actually re-renders when that slice
      // changes — otherwise nothing would call `useOwnership` a second time to observe.
      events: useGameSlice((state) => state.slices.events),
    }));
    const first = result.current.ownership;

    seedSlices({ events: [] });

    expect(result.current.ownership).toBe(first);
  });

  it("returns a new Map when ownership actually changes", () => {
    seedSlices({
      ownership: [{ systemId: "sys-1", factionId: "f1", developed: true, forming: false }],
    });
    const { result } = renderHook(() => useOwnership());
    const first = result.current;

    seedSlices({
      ownership: [{ systemId: "sys-1", factionId: "f2", developed: true, forming: false }],
    });

    expect(result.current).not.toBe(first);
    expect(result.current.get("sys-1")?.factionId).toBe("f2");
  });
});
