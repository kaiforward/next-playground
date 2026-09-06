/**
 * A pure water-level solver: given a set of worlds each with a current cover, a target cover and a
 * demand, and a supply to hand out, finds the single level `L` (in cycles of `demand`) that raises
 * every world below it to `L` — or to its own target, if that is lower — while spending no more than
 * the supply, and spending all of it unless every world already reaches its target first.
 *
 * All quantities except `demand` are in cycles of `demand` (a cycle is one unit of `demand`'s
 * reference period). `demand` itself is units per cycle. Callers must only pass worlds with
 * `demand > 0` — a deficit implies a positive demand — but a world with `demand <= 0` is tolerated
 * here by contributing nothing rather than throwing, since it can never want anything.
 */
export interface LevelWorld {
  id: string;
  /** Current cover, in cycles of `demand`. */
  levelCover: number;
  /** The cover this world stops wanting more at, in cycles of `demand`. */
  targetCover: number;
  /** Units wanted per cycle. Must be > 0 for a world to receive any raise. */
  demand: number;
}

/** The units a world would draw if the water level were `level`, capped at its own target. */
export function raiseFor(world: LevelWorld, level: number): number {
  if (world.demand <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(level, world.targetCover) - world.levelCover) * world.demand;
}

/**
 * The water level `L` at which Σ `raiseFor(world, L)` over `worlds` equals
 * `min(supply, Σ raiseFor(world, largestTarget))` — the full want when supply covers it, otherwise
 * the level that spends exactly `supply`. `L` never exceeds the largest `targetCover` among the
 * worlds handed in, and is 0 for an empty list.
 *
 * `raiseFor` is monotonic non-decreasing and continuous in `level` (each world's raise rises
 * linearly with `level` until it hits its own target, then holds flat), so the total raise as a
 * function of `level` is too — `L` is found by bisecting on it.
 */
export function solveWaterLevel(worlds: readonly LevelWorld[], supply: number): number {
  const active = worlds.filter((world) => world.demand > 0);
  if (active.length === 0) {
    return 0;
  }

  const largestTarget = Math.max(...active.map((world) => world.targetCover));
  const totalWant = active.reduce((sum, world) => sum + raiseFor(world, largestTarget), 0);
  const target = Math.max(0, Math.min(supply, totalWant));

  const lowestCover = Math.min(...active.map((world) => world.levelCover));
  if (target <= 0) {
    return lowestCover;
  }

  const totalRaiseAt = (level: number): number =>
    active.reduce((sum, world) => sum + raiseFor(world, level), 0);

  // Bisection halves the bracket each step, so over a bracket of a few tens of cycles it reaches
  // double precision within ~60 steps; 100 is a ceiling, never a tuned figure. `hi` is returned so
  // the result never under-spends the target: the total raise at `hi` is ≥ `target` throughout.
  let lo = lowestCover;
  let hi = largestTarget;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (totalRaiseAt(mid) < target) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return hi;
}
