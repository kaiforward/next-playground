/**
 * The store-backed hook test setup (client-runtime) — every hook in `lib/hooks/`
 * now reads the module-level `gameStore` singleton (`lib/store/use-game-store.ts`) instead of a
 * `useSuspenseQuery`, so a hook test seeds that singleton directly rather than wrapping a component
 * tree in a `QueryClientProvider`. This is the "hook test setup" the build plan names.
 *
 * `gameStore` is one instance for the whole test file (module registries are fresh per file under
 * vitest's default isolation, but shared across every `it()` within one file — the same constraint
 * `lib/store/__tests__/use-game-store.test.tsx` already documents for `setLiveness`). `applyStateFrame`
 * drops a frame at or behind the held `frameSeq` (the store's freshness guard,
 * `lib/store/game-store.ts`), so seeding a second time with the SAME frameSeq cannot overwrite the
 * first — `seedSlices` therefore hands out a strictly increasing `frameSeq` (and `worldVersion`, kept
 * in lockstep since nothing here needs them to diverge) on every call, module-scoped across the
 * whole file, so each test's seed is always accepted regardless of `it()` order.
 */
import { act } from "@testing-library/react";
import { gameStore } from "@/lib/store/use-game-store";
import type { SnapshotSlices } from "@/lib/runtime/snapshot";

let version = 0;

/** Applies a frame carrying exactly the given slices, at a frameSeq/worldVersion newer than any
 *  previous seed in this test file. Slices not named here keep whatever a previous seed in this
 *  file left them at — callers that care about isolation from another test's slices should set
 *  every slice their assertions read. */
export function seedSlices(slices: Partial<SnapshotSlices>): void {
  version += 1;
  act(() => {
    gameStore.applyStateFrame({ frameSeq: version, worldVersion: version, slices });
  });
}
