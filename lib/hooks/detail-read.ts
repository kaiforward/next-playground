"use client";

/**
 * The shared read path for the interest-keyed detail hooks (frame-architecture spec, "Interest
 * protocol") — every per-id detail hook (`use-system-vitals.ts` and its eight siblings) routes its
 * store read through `useDetailEntry` instead of calling `useGameSlice` directly, passing the
 * SnapshotSlices key itself as `family` rather than a hand-rolled selector — same synchronous,
 * non-null-shaped read as before, just funnelled through one place so the dev diagnostic below
 * lives in exactly one spot.
 *
 * A detail slice entry is absent for two reasons now, not one: the id never existed, or it exists
 * but nothing has told the worker it is of interest (frame not landed yet, or a missing
 * `useInterest` registration). Both reasons return the SAME fallback — telling them apart is the
 * panel-root presence gate's job (`components/panels/system-panel.tsx`,
 * `components/market/market-comparison-panel.tsx`, both via `useDetailPresent` below), never this
 * hook's. `useDetailEntry` only adds a diagnostic for the second case, in dev builds, so a future
 * surface that calls a detail hook without wiring `useInterest` announces itself at first render
 * instead of silently shipping "unknown" data forever. That diagnostic is only meaningful for a read
 * BELOW the panel root's presence gate — a hook called above the gate (or with no gate at all) would
 * warn on every ordinary first render, before the gate itself has a chance to hold the id back.
 */
import { useGameSlice } from "@/lib/store/use-game-store";
import { useUniverse } from "./use-universe";
import { GOODS } from "@/lib/constants/goods";
import type { MarketSlice, MarketComparisonSlice } from "@/lib/runtime/snapshot";
import type { UniverseData } from "@/lib/types/game";
import type {
  SystemVitalsData, SystemPopulationData, SystemIndustryData, SystemLogisticsData,
  SystemConstructionData, SystemBuildOptionsData, SystemSubstrateData, LaneDetailData,
} from "@/lib/types/api";

/** Which id space a detail hook's `id` is drawn from — determines what "exists" means for the
 *  dev-only unsubscribed-read warning below. `"system"` ids are checked against the `universe`
 *  slice's system list (the eight system-keyed families); `"good"` ids are checked against the
 *  static goods catalog (`marketComparison`, the one good-keyed family) — a goodId is never a
 *  member of `universe.systems`, so treating every family as system-keyed would make the warning
 *  structurally unable to fire for `marketComparison`. `"lane"` opts a family out of the warning
 *  entirely (below): a lane key has no cheap galaxy-wide membership set to check it against. */
export type DetailIdSpace = "system" | "good" | "lane";

/** The interest-keyed detail families a per-id hook can read (frame-architecture spec) — every
 *  `SnapshotSlices` key backed by the current interest set rather than pushed coarse. Typing
 *  `useDetailEntry`'s `family` parameter as this union (rather than bare `string`) is what lets it
 *  derive `slices[family]?.[id]` itself instead of every call site re-deriving the same selector. */
export type DetailFamily =
  | "systemVitals"
  | "systemPopulation"
  | "systemIndustry"
  | "systemLogistics"
  | "systemConstruction"
  | "systemBuildOptions"
  | "systemSubstrate"
  | "market"
  | "marketComparison"
  | "laneDetail";

/** Maps each `DetailFamily` to its per-id entry type — the same mapping `SnapshotSlices` (each
 *  family's `Record<string, ...>` value type) already encodes, restated here as a plain interface so
 *  `useDetailEntry` below can be declared as one overload per literal family rather than a single
 *  generic signature: a generic indexed access (`SnapshotSlices[F][string]`) can't be carried through
 *  a single generic function body — the compiler evaluates it against `F`'s full union bound rather
 *  than the one branch a given call actually takes. Each overload's return type comes from this map;
 *  the implementation signature's own `family: DetailFamily` parameter is a plain union (not a type
 *  parameter), which TypeScript CAN distribute correctly over `state.slices[family]`. */
interface DetailFamilyValueMap {
  systemVitals: SystemVitalsData;
  systemPopulation: SystemPopulationData;
  systemIndustry: SystemIndustryData;
  systemLogistics: SystemLogisticsData;
  systemConstruction: SystemConstructionData;
  systemBuildOptions: SystemBuildOptionsData;
  systemSubstrate: SystemSubstrateData;
  market: MarketSlice;
  marketComparison: MarketComparisonSlice;
  laneDetail: LaneDetailData;
}

const warnedPairs = new Set<string>();

/**
 * Clears the dev-only unsubscribed-read warning latch (frame-architecture spec) — called from
 * `client/main.tsx`'s `isReplacing` true->false handler, alongside `interestRegistry.resend()`. A
 * world replacement re-mints ids that can coincide with the outgoing world's (a new galaxy's
 * world-gen can produce the same system id sequence, and every good id is drawn from the one fixed
 * catalog regardless of world), so a warning already latched for a (family, id) pair in the old
 * world would otherwise permanently suppress a genuine missing-interest bug in the new one.
 */
export function resetDetailReadWarnings(): void {
  warnedPairs.clear();
}

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

// The dev-only universe-id membership cache — ONE Set shared across every
// detail-hook instance (a system panel mounts nine of these hooks at once), rebuilt only when the
// `universe` slice reference actually changes, rather than a `useMemo` per hook instance rebuilding
// the same Set nine times over. Module-scoped deliberately: this is a pure derived cache keyed on
// object identity, not component state.
let cachedUniverse: UniverseData | null = null;
let cachedUniverseIds: Set<string> = new Set();

function universeIdsFor(universe: UniverseData): Set<string> {
  if (cachedUniverse !== universe) {
    cachedUniverse = universe;
    cachedUniverseIds = new Set(universe.systems.map((s) => s.id));
  }
  return cachedUniverseIds;
}

/**
 * The dev-only system-id membership read behind the unsubscribed-read warning. `!import.meta.env.DEV`
 * is a literal `true` in a production build (the same Rollup dead-code idiom `dev-commands.ts` uses),
 * so the `useUniverse()` subscription and the cache lookup below it are eliminated from the
 * production bundle entirely — production detail hooks never subscribe to `universe` at all. Safe as
 * a conditional hook call because the condition is a build-time constant: every render of a given
 * build takes the same branch, so hook call order never varies across renders.
 */
function useUniverseIdsDev(): Set<string> | null {
  if (!import.meta.env.DEV) return null;
  const { data: universe } = useUniverse();
  return universeIdsFor(universe);
}

/**
 * Reads `family`'s slice entry for `id` from the store's current slices — `slices[family]?.[id]`,
 * derived internally rather than taking a selector, so the selector/label pair isn't duplicated at
 * every one of the nine call sites. In dev builds only (`import.meta.env.DEV` literal), warns once
 * per (family, id) the first time the selected entry is `undefined` while `id` exists in its
 * `idSpace` (the `universe` slice's system list for `"system"`, the goods catalog for `"good"`) —
 * the routine "not currently subscribed" case is silent everywhere except this diagnostic.
 * Production behaviour matches a direct `useGameSlice` read except for one always-paid cost:
 * `useUniverseIdsDev` still runs its hook (a no-op stub, see that function's own docstring) so hook
 * order never varies between dev and prod builds.
 */
export function useDetailEntry(
  family: "systemVitals", id: string, idSpace: DetailIdSpace,
): SystemVitalsData | undefined;
export function useDetailEntry(
  family: "systemPopulation", id: string, idSpace: DetailIdSpace,
): SystemPopulationData | undefined;
export function useDetailEntry(
  family: "systemIndustry", id: string, idSpace: DetailIdSpace,
): SystemIndustryData | undefined;
export function useDetailEntry(
  family: "systemLogistics", id: string, idSpace: DetailIdSpace,
): SystemLogisticsData | undefined;
export function useDetailEntry(
  family: "systemConstruction", id: string, idSpace: DetailIdSpace,
): SystemConstructionData | undefined;
export function useDetailEntry(
  family: "systemBuildOptions", id: string, idSpace: DetailIdSpace,
): SystemBuildOptionsData | undefined;
export function useDetailEntry(
  family: "systemSubstrate", id: string, idSpace: DetailIdSpace,
): SystemSubstrateData | undefined;
export function useDetailEntry(
  family: "market", id: string, idSpace: DetailIdSpace,
): MarketSlice | undefined;
export function useDetailEntry(
  family: "marketComparison", id: string, idSpace: DetailIdSpace,
): MarketComparisonSlice | undefined;
export function useDetailEntry(
  family: "laneDetail", id: string, idSpace: DetailIdSpace,
): LaneDetailData | undefined;
export function useDetailEntry(
  family: DetailFamily,
  id: string,
  idSpace: DetailIdSpace,
): DetailFamilyValueMap[DetailFamily] | undefined {
  const entry = useGameSlice(
    (state): DetailFamilyValueMap[DetailFamily] | undefined => state.slices[family]?.[id],
  );
  const universeIds = useUniverseIdsDev();

  if (import.meta.env.DEV && entry === undefined && idSpace !== "lane") {
    const existsInIdSpace = idSpace === "good" ? Object.hasOwn(GOODS, id) : (universeIds?.has(id) ?? false);
    if (existsInIdSpace) warnUnsubscribedRead(family, id);
  }

  return entry;
}

/**
 * The presence gate's own read (frame-architecture spec, "First-paint gate") — `true` once `family`'s
 * entry for `id` has landed, `false` while it's held (subscribed but not yet delivered, or the game
 * is paused). Shares the exact selector shape `useDetailEntry` uses internally so a panel root's gate
 * and its hooks below the gate can never disagree about what "present" means for the same family/id.
 */
export function useDetailPresent(family: DetailFamily, id: string): boolean {
  return useGameSlice((state) => state.slices[family]?.[id] !== undefined);
}
