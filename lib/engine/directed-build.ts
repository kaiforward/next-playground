/**
 * Pure directed-build planning — zero DB dependency. The faction build planner:
 * given each system's market state + buildable capacity and a route-cost function,
 * find structural deficits (a deficit with no reachable surplus) and decide what
 * production (+ co-built housing) to add where, demand-pulled. The processor maps
 * DB/sim rows into BuildSystemState and applies the returned PlannedBuild[].
 * See docs/plans/sp5-stage1-seed-coherence-design.md.
 */
import type { ResourceVector } from "@/lib/types/game";
import { DIRECTED_BUILD } from "@/lib/constants/directed-build";

/** Market state for one good at one system — the build planner's per-good input. */
export interface BuildGoodState {
  goodId: string;
  stock: number;
  targetStock: number;
  /** Total local demand rate (civilian + industrial); severity weight only. */
  demand: number;
}

/** A system's buildable state — markets + the body-derived capacity it can build into. */
export interface BuildSystemState {
  systemId: string;
  factionId: string | null;
  population: number;
  /** Current building counts (production types + "housing"). */
  buildings: Record<string, number>;
  /** Per-resource deposit-slot cap (Σ body slots) — caps tier-0 extractor counts. */
  slotCap: ResourceVector;
  /** Fungible general space — tier-1+ factories + housing draw here. */
  generalSpace: number;
  /** Habitable subset of space — additionally caps housing. */
  habitableSpace: number;
  goods: BuildGoodState[];
}

/** One build action: add `count` units of `buildingType` (a good id, or "housing") at `systemId`. */
export interface PlannedBuild {
  systemId: string;
  buildingType: string;
  count: number;
}

/** This system's per-cycle build-unit budget (free, population-scaled in v1). */
export function systemBuildGeneration(population: number): number {
  return Math.max(0, population) * DIRECTED_BUILD.GENERATION_PER_POP;
}
