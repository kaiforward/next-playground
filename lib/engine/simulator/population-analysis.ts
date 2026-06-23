import type { SimSystem } from "./types";

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

/** Σ of all building counts in a system. */
function totalBuilt(s: SimSystem): number {
  let n = 0;
  for (const count of Object.values(s.buildings)) n += Math.max(0, count);
  return n;
}

export function summarizeInfrastructure(
  systems: SimSystem[],
  initialBuildingTotal: number,
): InfrastructureSummary {
  let builtEnd = 0;
  let collapsedCount = 0;
  for (const s of systems) {
    const built = totalBuilt(s);
    builtEnd += built;
    if (built < 1) collapsedCount++;
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
  /** Systems within 2% of popCap (saturation watch). */
  saturatedCount: number;
  /** Systems with population ≤ 1 (ghost-town watch). */
  emptiedCount: number;
  /** Systems with unrest ≥ strikeThreshold (striking). */
  strikingCount: number;
}

export function summarizePopulation(
  systems: SimSystem[],
  totalStart: number,
  strikeThreshold: number,
): PopulationSummary {
  let totalEnd = 0;
  let unrestSum = 0;
  let maxUnrest = 0;
  let saturatedCount = 0;
  let emptiedCount = 0;
  let strikingCount = 0;

  for (const s of systems) {
    totalEnd += s.population;
    unrestSum += s.unrest;
    if (s.unrest > maxUnrest) maxUnrest = s.unrest;
    if (s.popCap > 0 && s.population >= s.popCap * 0.98) saturatedCount++;
    if (s.population <= 1) emptiedCount++;
    if (s.unrest >= strikeThreshold) strikingCount++;
  }

  const n = Math.max(1, systems.length);
  return {
    totalStart,
    totalEnd,
    growthPct: totalStart > 0 ? ((totalEnd - totalStart) / totalStart) * 100 : 0,
    meanUnrest: unrestSum / n,
    maxUnrest,
    saturatedCount,
    emptiedCount,
    strikingCount,
  };
}
