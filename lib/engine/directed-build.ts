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
import { classifyMarketState, type RouteCost } from "@/lib/engine/directed-logistics";
import { GOOD_TIER_BY_KEY } from "@/lib/constants/goods";
import { BUILDING_TYPES, OUTPUT_PER_UNIT, effectiveSpaceCost, HOUSING_TYPE } from "@/lib/constants/industry";

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

/** A deficit with no reachable surplus of its good — the build target. */
export interface StructuralDeficit {
  systemId: string;
  goodId: string;
  shortfall: number;
  demand: number;
}

/**
 * Find deficits that logistics cannot serve because no reachable surplus of the
 * good exists. Build classification per (system, good); collect deficits and the
 * surplus-holding systems per good; a deficit is structural when no surplus system
 * of its good can reach it (routeCost(surplus, deficit) non-null).
 */
export function findStructuralDeficits(
  systems: BuildSystemState[],
  routeCost: RouteCost,
): StructuralDeficit[] {
  const deficits: Array<{ systemId: string; goodId: string; shortfall: number; demand: number }> = [];
  const surplusSystemsByGood = new Map<string, string[]>();

  for (const s of systems) {
    for (const g of s.goods) {
      const c = classifyMarketState(g.stock, g.targetStock);
      if (c.kind === "deficit" && c.shortfall > 0) {
        deficits.push({ systemId: s.systemId, goodId: g.goodId, shortfall: c.shortfall, demand: g.demand });
      } else if (c.kind === "surplus" && c.drawable > 0) {
        const list = surplusSystemsByGood.get(g.goodId) ?? [];
        list.push(s.systemId);
        surplusSystemsByGood.set(g.goodId, list);
      }
    }
  }

  const structural: StructuralDeficit[] = [];
  for (const d of deficits) {
    const sources = surplusSystemsByGood.get(d.goodId) ?? [];
    const reachableSurplus = sources.some((su) => routeCost(su, d.systemId) !== null);
    if (!reachableSurplus) structural.push(d);
  }
  return structural;
}

/**
 * General space consumed by current buildings: every tier-1+ factory and housing
 * occupies general space (× its footprint). Tier-0 extractors sit on deposit slots,
 * NOT general space, so they are excluded.
 */
function generalSpaceUsed(buildings: Record<string, number>): number {
  let used = 0;
  for (const [type, count] of Object.entries(buildings)) {
    if (count <= 0) continue;
    if (type === HOUSING_TYPE) {
      used += count * effectiveSpaceCost(type);
      continue;
    }
    if (GOOD_TIER_BY_KEY[type] === 0) continue; // extractors don't use general space
    used += count * effectiveSpaceCost(type);
  }
  return used;
}

/** Deposit-slot units already used for `resource` (goods sharing the resource share the cap). */
function extractorsOnResource(buildings: Record<string, number>, resource: string): number {
  let used = 0;
  for (const [type, count] of Object.entries(buildings)) {
    if (count <= 0 || GOOD_TIER_BY_KEY[type] !== 0) continue;
    if (BUILDING_TYPES[type]?.resource === resource) used += count;
  }
  return used;
}

/**
 * Additional building units of `goodId` a system can host given current builds.
 * Tier-0: remaining deposit slots for the good's resource. Tier-1+: remaining
 * general space ÷ the type's footprint. Never negative.
 */
export function buildableUnits(sys: BuildSystemState, goodId: string): number {
  const tier = GOOD_TIER_BY_KEY[goodId];
  if (tier === undefined) return 0;
  if (tier === 0) {
    const resource = BUILDING_TYPES[goodId]?.resource;
    if (!resource) return 0;
    const cap = sys.slotCap[resource];
    const remaining = cap - extractorsOnResource(sys.buildings, resource);
    return Math.max(0, remaining);
  }
  const cost = effectiveSpaceCost(goodId);
  if (cost <= 0) return 0;
  const remainingGeneral = sys.generalSpace - generalSpaceUsed(sys.buildings);
  return Math.max(0, remainingGeneral / cost);
}

/** Additional output of `goodId` a system can host = buildable units × per-unit output. */
export function buildableOutput(sys: BuildSystemState, goodId: string): number {
  return buildableUnits(sys, goodId) * (OUTPUT_PER_UNIT[goodId] ?? 0);
}
