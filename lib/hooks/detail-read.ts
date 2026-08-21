"use client";

/**
 * The shared read path for the interest-keyed detail hooks (frame-architecture spec, "Interest
 * protocol", "Store and signature consequences"). Every per-id detail hook (`use-system-vitals.ts`
 * and its eight siblings) routes its store read through `useDetailEntry` instead of calling
 * `useGameSlice` directly — same synchronous, non-null-shaped read as before, just funnelled
 * through one place so the dev diagnostic below lives in exactly one spot.
 *
 * A detail slice entry is absent for two reasons now, not one: the id never existed, or it exists
 * but nothing has told the worker it is of interest (frame not landed yet, or a missing
 * `useInterest` registration). Both reasons return the SAME fallback — telling them apart is the
 * panel-root presence gate's job (`components/panels/system-panel.tsx`,
 * `components/market/market-comparison-panel.tsx`), never this hook's. `useDetailEntry` only adds
 * a diagnostic for the second case, in dev builds, so a future surface that calls a detail hook
 * without wiring `useInterest` announces itself at first render instead of silently shipping
 * "unknown" data forever.
 */
import { useMemo } from "react";
import { useGameSlice } from "@/lib/store/use-game-store";
import { useUniverse } from "./use-universe";
import { GOODS } from "@/lib/constants/goods";
import type { SnapshotSlices } from "@/lib/runtime/snapshot";

/** Which id space a detail hook's `id` is drawn from — determines what "exists" means for the
 *  dev-only unsubscribed-read warning below. `"system"` ids are checked against the `universe`
 *  slice's system list (the eight system-keyed families); `"good"` ids are checked against the
 *  static goods catalog (`marketComparison`, the one good-keyed family) — a goodId is never a
 *  member of `universe.systems`, so treating every family as system-keyed would make the warning
 *  structurally unable to fire for `marketComparison`. */
export type DetailIdSpace = "system" | "good";

const warnedPairs = new Set<string>();

function warnUnsubscribedRead(family: string, id: string): void {
  const key = `${family}:${id}`;
  if (warnedPairs.has(key)) return;
  warnedPairs.add(key);
  // eslint-disable-next-line no-console -- deliberate dev-only diagnostic, guarded by import.meta.env.DEV at the call site
  console.warn(
    `[detail-read] "${family}" has no entry for id "${id}", though it exists in the galaxy — ` +
      `likely a missing useInterest() registration for this id, or a read before its panel's ` +
      `first frame has landed.`,
  );
}

/**
 * Reads `select` over the store's current slices. In dev builds only (`import.meta.env.DEV`
 * literal, per the Rollup dead-code rule — `client/worker/game-worker.ts`'s `loadDevHandlers`
 * guard), warns once per (family, id) the first time the selected entry is `undefined` while `id`
 * exists in its `idSpace` (the `universe` slice's system list for `"system"`, the goods catalog
 * for `"good"`) — the routine "not currently subscribed" case is silent everywhere except this
 * diagnostic. Production behaviour matches a direct `useGameSlice` read except for one always-paid
 * cost: `useUniverse` is subscribed unconditionally (every call site, including `"good"` ones that
 * never consult it) so that `idSpace` can vary without making this a conditional hook call —
 * production skips only the `Set` construction and the warning check themselves, both dev-gated
 * below.
 */
export function useDetailEntry<T>(
  select: (slices: Partial<SnapshotSlices>) => T | undefined,
  family: string,
  id: string,
  idSpace: DetailIdSpace,
): T | undefined {
  const entry = useGameSlice((state) => select(state.slices));
  const { data: universe } = useUniverse();
  // Built only in dev — `!import.meta.env.DEV` is a literal `true` in a production build, so
  // Rollup dead-code-eliminates the `new Set(...)` construction below along with the warning call
  // site that consumes it. Irrelevant for `idSpace === "good"` (GOODS is a static catalog, not a
  // slice), but built regardless — cheap, and keeping one dev-gated shape for both id spaces is
  // simpler than branching the memo itself.
  const universeIds = useMemo(() => {
    if (!import.meta.env.DEV) return null;
    return new Set(universe.systems.map((s) => s.id));
  }, [universe]);

  if (import.meta.env.DEV && entry === undefined) {
    const existsInIdSpace = idSpace === "good" ? Object.hasOwn(GOODS, id) : (universeIds?.has(id) ?? false);
    if (existsInIdSpace) warnUnsubscribedRead(family, id);
  }

  return entry;
}
