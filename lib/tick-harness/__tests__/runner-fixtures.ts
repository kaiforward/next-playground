import { runTickHarness } from "../runner";
import type { HarnessConfig, HarnessResults } from "../types";

/**
 * Big enough that colonies are founded, migration resolves and goods move. The tick count is set by
 * the establish duration, which is denominated in construction cycles and therefore cadence-invariant:
 * the absorption cap funds 0.4 work per cycle, so a 68-work establish takes ~170 cycles and the first
 * colony on this seed lands at tick 4176 — before which the galaxy has no same-faction developed pair
 * at all, so migration, directed logistics and every counter downstream of them read a flat zero. The
 * horizon is then set by the slowest of the counters read below: the demand-hunting flip rate, which
 * clears its bound from ~7,000 ticks on (measured 0.0090 here, against a bound of 0.005). ~18s.
 *
 * Shared across the files that read it: `runTickHarness` is deterministic, so this config is the
 * single source of truth for BUSY-derived fixtures in every file, even the ones that run it fresh
 * rather than through a memoised accessor (a module-level memo does not share across Vitest workers,
 * so only the file that OWNS the memoised run may define one — see `runner-instrumentation.test.ts`).
 */
export const BUSY: HarnessConfig = { systemCount: 60, seed: 7, tickCount: 10_000 };

/**
 * Colonisation pacing (when the first transfer lands) is a function of the archetype/sun-class
 * tables, not a constant this suite owns — so instead of a hardcoded tick count, search forward
 * in fixed steps for the first tickCount at which the condition holds, bounded by maxTickCount.
 * Throws (failing the calling test with a clear message) if the bound is hit first.
 */
export async function firstRunWhere(
  base: { systemCount: number; seed: number },
  isSatisfied: (results: HarnessResults) => boolean,
  { start, step, maxTickCount }: { start: number; step: number; maxTickCount: number },
): Promise<HarnessResults> {
  for (let tickCount = start; tickCount <= maxTickCount; tickCount += step) {
    const results = await runTickHarness({ ...base, tickCount });
    if (isSatisfied(results)) return results;
  }
  throw new Error(
    `condition never observed for seed=${base.seed}/systemCount=${base.systemCount} by tickCount=${maxTickCount}`,
  );
}
