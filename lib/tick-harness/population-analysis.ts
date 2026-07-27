import type { TickSystem } from "@/lib/tick/rows";
import { crowdFactor } from "@/lib/engine/population";

export interface InfrastructureSummary {
  /** Total building count across all systems at tick 0. */
  builtStart: number;
  /** Total building count across all systems at simulation end. */
  builtEnd: number;
  /** Percentage of the built base that decayed away. */
  decayedPct: number;
  /** Systems whose entire built base has rotted to ~0 (ghost-industry watch). */
  collapsedCount: number;
}

/**
 * A system somebody actually lives on. Every population/infrastructure reading below is a statement
 * about inhabited worlds, and the galaxy is overwhelmingly empty — at default scale 580 of 600
 * systems are unclaimed. Folding those in turns a rate into a measure of how much void was generated.
 */
function isSettled(s: TickSystem): boolean {
  return s.control === "developed";
}

/** Σ of all building counts in a system. */
function totalBuilt(s: TickSystem): number {
  let n = 0;
  for (const count of Object.values(s.buildings)) n += Math.max(0, count);
  return n;
}

export function summarizeInfrastructure(
  systems: TickSystem[],
  initialBuildingTotal: number,
): InfrastructureSummary {
  let builtEnd = 0;
  let collapsedCount = 0;
  for (const s of systems) {
    const built = totalBuilt(s);
    builtEnd += built;
    // Only a SETTLED system can have collapsed. An unclaimed rock has no buildings because nobody
    // ever built any — counting it as ghost industry buries the handful of real collapses under
    // however many systems the galaxy happens to contain.
    if (built < 1 && isSettled(s)) collapsedCount++;
  }
  return {
    builtStart: initialBuildingTotal,
    builtEnd,
    decayedPct: initialBuildingTotal > 0 ? ((initialBuildingTotal - builtEnd) / initialBuildingTotal) * 100 : 0,
    collapsedCount,
  };
}

/**
 * Migration ping-pong: a system whose population direction reverses many times
 * across snapshots is oscillating (two systems trading the same people). Counts
 * systems with ≥ minReversals sign changes in successive population deltas.
 */
export function detectPingPong(
  snapshots: Array<Map<string, number>>, minReversals = 4,
): number {
  if (snapshots.length < 3) return 0;
  const ids = snapshots[0].keys();
  let count = 0;
  for (const id of ids) {
    let reversals = 0;
    let prevSign = 0;
    for (let i = 1; i < snapshots.length; i++) {
      const delta = (snapshots[i].get(id) ?? 0) - (snapshots[i - 1].get(id) ?? 0);
      const sign = Math.sign(delta);
      if (sign !== 0 && prevSign !== 0 && sign !== prevSign) reversals++;
      if (sign !== 0) prevSign = sign;
    }
    if (reversals >= minReversals) count++;
  }
  return count;
}

export interface PopulationSummary {
  totalStart: number;
  totalEnd: number;
  growthPct: number;
  meanUnrest: number;
  maxUnrest: number;
  // Every field below counts, averages, or shares over SETTLED systems only (`totalStart`/`totalEnd`
  // are galaxy-wide, but an unsettled system holds no people so the two agree). The galaxy is mostly
  // void by design — rating unrest or striking against 600 systems when 20 are inhabited reports the
  // emptiness of space, not the health of the economy.
  /** Systems within 2% of popCap — the crowd brake's healthy resting state (growth runs at full
   *  rate to r = population/popCap = 1, then brakes smoothly), not a saturation pathology. */
  saturatedCount: number;
  /** Systems with popCap > 0 whose growth brake has crushed to <= 0.25 (crowdFactor near the
   *  brake's end, r near CROWDING.BRAKE_END) — the pathology watch: pinned at the brake while
   *  relief housing exists and land is available means the growth valve is blocked, not that the
   *  world is genuinely full. The count itself checks neither, so a high reading is a prompt to
   *  look at land and relief builds, not evidence on its own that the valve is at fault. */
  brakedCount: number;
  /** Mean population/popCap across systems with popCap > 0 — the occupancy watch's headline
   *  number. 0 when no system has any housing (guarded so an all-zero-popCap run reports 0,
   *  never NaN). */
  meanOccupancy: number;
  /** Systems with population ≤ 1 (ghost-town watch). */
  emptiedCount: number;
  /** Systems with unrest ≥ strikeThreshold (striking). */
  strikingCount: number;
  /** Striking systems as a share of those counted, in [0,1]. The count alone reads differently as
   *  the galaxy grows — 300 striking of 400 and 300 of 3000 are not the same galaxy. */
  strikingShare: number;
  /** Systems holding population with effectively no housing left (popCap ≈ 0). The trap the collapse
   *  channel's housing floor closes: with popCap 0 the crowd brake reads fully crowded so growth is
   *  exactly zero, overshoot-death fires, and the relief valve cannot rebuild until the system is
   *  fed — which needs the capacity just demolished. Should read ~0; anything else is a population
   *  that cannot grow, shrink into safety, or be helped. */
  strandedCount: number;
  /** Total population held in those stranded systems — how many people are actually caught, which
   *  the count alone does not say. */
  strandedPopulation: number;
}

/** popCap at or below this counts as "no housing left" — popCap is a whole-level multiple, so this
 *  is comfortably below one level rather than an arbitrary epsilon. */
const STRANDED_POP_CAP = 1e-6;

export function summarizePopulation(
  systems: TickSystem[],
  totalStart: number,
  strikeThreshold: number,
  crowdBrakeEnd: number,
): PopulationSummary {
  let totalEnd = 0;
  let unrestSum = 0;
  let maxUnrest = 0;
  let saturatedCount = 0;
  let brakedCount = 0;
  let occupancySum = 0;
  let occupancyCount = 0;
  let emptiedCount = 0;
  let strikingCount = 0;
  let strandedCount = 0;
  let strandedPopulation = 0;

  // Totals are over the whole galaxy (an unsettled system holds no people, so it adds nothing);
  // every rate, share and count below is over settled systems, which is what they are claims about.
  for (const s of systems) totalEnd += s.population;
  const settled = systems.filter(isSettled);

  for (const s of settled) {
    unrestSum += s.unrest;
    if (s.unrest > maxUnrest) maxUnrest = s.unrest;
    if (s.population > 0 && s.popCap <= STRANDED_POP_CAP) {
      strandedCount++;
      strandedPopulation += s.population;
    }
    if (s.popCap > 0) {
      if (s.population >= s.popCap * 0.98) saturatedCount++;
      if (crowdFactor(s.population, s.popCap, crowdBrakeEnd) <= 0.25) brakedCount++;
      occupancySum += s.population / s.popCap;
      occupancyCount++;
    }
    if (s.population <= 1) emptiedCount++;
    if (s.unrest >= strikeThreshold) strikingCount++;
  }

  const n = Math.max(1, settled.length);
  return {
    totalStart,
    totalEnd,
    growthPct: totalStart > 0 ? ((totalEnd - totalStart) / totalStart) * 100 : 0,
    meanUnrest: unrestSum / n,
    maxUnrest,
    saturatedCount,
    brakedCount,
    meanOccupancy: occupancyCount > 0 ? occupancySum / occupancyCount : 0,
    emptiedCount,
    strikingCount,
    strikingShare: settled.length > 0 ? strikingCount / settled.length : 0,
    strandedCount,
    strandedPopulation,
  };
}
