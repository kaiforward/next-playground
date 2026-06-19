import type { SimSystem } from "./types";

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
