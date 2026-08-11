/**
 * Adaptive expectation — the persisted per-system memory of the Provision a population has grown
 * accustomed to (docs/active/gameplay/economy.md, "The memory"). Unrest's
 * supply term reads the gap between this memory and today's delivery, not the distance from
 * perfection. Two pure functions, no I/O:
 *  - readExpectation()   resolves a stored value (or its absence) into what this cycle's unrest
 *                        read should use, BEFORE anything this cycle changes it.
 *  - updateExpectation() advances the memory by one cycle's worth of sub-stepped asymmetric
 *                        relaxation, ready for the population processor to write back for NEXT
 *                        cycle's read.
 * The split matters: the read must happen against last cycle's memory, so a cycle's own response
 * is judged against what the population expected walking in, not against what it just became.
 */

import { clamp } from "@/lib/utils/math";

/** Sub-stepped asymmetric EMA parameters — all three rates/floor stated per reference cycle. */
export interface ExpectationParams {
  /** Floor on the EFFECTIVE expectation only (`readExpectation`'s output) — never written into
   *  the stored value, so the stored memory stays honest even while the read the fold consumes is
   *  clamped upward. */
  floor: number;
  /** Unscaled per-sub-step rate applied when this cycle's Provision exceeds the stored memory
   *  (standards rise). */
  riseRate: number;
  /** Unscaled per-sub-step rate applied when this cycle's Provision is below the stored memory
   *  (resignation). */
  resignRate: number;
}

/**
 * Resolves the stored memory into what this cycle's unrest read should use.
 *
 * The validity guard: `stored` is treated as absent — "could not read", never "remembers
 * perfection", the read-side guard that also keeps the effective reading ≤ 1 — whenever it is
 * `undefined`, non-finite, or outside [0, 1]. In every one of those cases the reading seeds from
 * `provision` (this cycle's Provision; clamped into [0,1] defensively, 0 if non-finite) exactly as
 * a first-use seed would — covering world-gen, colony founding, old saves, and a corrupted read
 * alike. `effective` is `max(stored, floor)`: the floor is a read-time policy, applied here and
 * ONLY here — it is never written back into `stored`, so the stored value remains an honest memory
 * even while the response this cycle reads the floor.
 */
export function readExpectation(
  stored: number | undefined,
  provision: number,
  params: ExpectationParams,
): { stored: number; effective: number } {
  const seed = Number.isFinite(provision) ? clamp(provision, 0, 1) : 0;
  const valid = stored !== undefined && Number.isFinite(stored) && stored >= 0 && stored <= 1;
  const resolvedStored = valid ? stored : seed;
  return { stored: resolvedStored, effective: Math.max(resolvedStored, params.floor) };
}

/**
 * Advances the stored memory by one cycle:
 *   stored <- stored + λ × (P − stored)
 * where λ is `riseRate` when P > stored (standards rise) or `resignRate` when P < stored
 * (resignation) — applied as `subSteps` iterations of the UNSCALED rates, the branch
 * re-evaluated every sub-step, never decided once per cycle.
 *
 * This is NOT catch-up invariant the way a plain relaxation is: the update is nonlinear
 * (branch-switching on P vs the moving stored value), so one step at `λ × subSteps` can land on
 * the opposite side of the branch boundary from where sub-stepping would have settled and
 * silently break the rise:resign ratio. Sizing `subSteps` from the tick interval is the caller's
 * job (population processor, from `catchUpFactor`) — this function only iterates the count given.
 *
 * Total: any finite `stored`/`provision` (clamped into [0,1] first, defensively) and any finite
 * `subSteps` (floored, negative treated as 0) produce a finite result in [0,1]. Each per-step rate
 * is itself clamped into [0,1] before use — so a rate above 1 saturates a single sub-step at
 * `stored ← provision` rather than overshooting — which makes every iteration a convex
 * combination of the current stored value and P: the result can never leave [0,1], and `stored`
 * can never cross past P in a single call.
 */
export function updateExpectation(
  stored: number,
  provision: number,
  params: ExpectationParams,
  subSteps: number,
): number {
  const p = Number.isFinite(provision) ? clamp(provision, 0, 1) : 0;
  let s = Number.isFinite(stored) ? clamp(stored, 0, 1) : 0;
  const steps = Number.isFinite(subSteps) ? Math.max(0, Math.floor(subSteps)) : 0;
  for (let i = 0; i < steps; i++) {
    const lambda = p > s ? params.riseRate : p < s ? params.resignRate : 0;
    s += clamp(lambda, 0, 1) * (p - s);
  }
  return clamp(s, 0, 1);
}
