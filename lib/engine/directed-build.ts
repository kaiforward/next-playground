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
import { BUILDING_TYPES, OUTPUT_PER_UNIT, effectiveSpaceCost, HOUSING_TYPE, POP_CENTRE_DENSITY } from "@/lib/constants/industry";
import { GOOD_RECIPES } from "@/lib/constants/recipes";
import { labourDemand, housingPopCap } from "@/lib/engine/industry";

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

/** A tier-1+ site is build-eligible this cycle only when every recipe input is locally produced or has a reachable surplus. */
function inputsAvailable(
  goodId: string,
  site: BuildSystemState,
  reachableSurplusGoods: Set<string>,
): boolean {
  const recipe = GOOD_RECIPES[goodId];
  if (!recipe) return true; // tier-0 has no recipe
  return Object.keys(recipe).every(
    (input) => (site.buildings[input] ?? 0) > 0 || reachableSurplusGoods.has(input),
  );
}

/**
 * Greedy demand-pulled build planner for ONE faction's systems. Budget = Σ system
 * generation, spent as building units. For each structural-gap good, score candidate
 * sites by the reachable structural demand they can serve (capacity-bounded,
 * nearest-first), build at the best, co-build housing to staff it, decrement, repeat.
 */
export function planFactionBuilds(
  systems: BuildSystemState[],
  routeCost: RouteCost,
): PlannedBuild[] {
  let budget = 0;
  for (const s of systems) budget += systemBuildGeneration(s.population);
  if (budget <= 0) return [];

  const structural = findStructuralDeficits(systems, routeCost);
  if (structural.length === 0) return [];

  // Goods for which this faction has a reachable surplus anywhere (for the tier-1+ input gate).
  const reachableSurplusGoods = new Set<string>();
  for (const s of systems) {
    for (const g of s.goods) {
      const c = classifyMarketState(g.stock, g.targetStock);
      if (c.kind === "surplus" && c.drawable > 0) reachableSurplusGoods.add(g.goodId);
    }
  }

  // Mutable per-system building working copy so capacity reflects builds made this pass.
  const working = new Map<string, BuildSystemState>();
  for (const s of systems) working.set(s.systemId, { ...s, buildings: { ...s.buildings } });

  // Remaining structural shortfall per (good → systemId → shortfall).
  const remainingByGood = new Map<string, Map<string, number>>();
  for (const d of structural) {
    const m = remainingByGood.get(d.goodId) ?? new Map<string, number>();
    m.set(d.systemId, (m.get(d.systemId) ?? 0) + d.shortfall);
    remainingByGood.set(d.goodId, m);
  }

  const builds: PlannedBuild[] = [];

  // Greedy: repeatedly pick the highest-scoring (site, good) and build there until budget runs out.
  while (budget > 0) {
    let best: { site: BuildSystemState; goodId: string; score: number; units: number } | null = null;

    for (const [goodId, deficitMap] of remainingByGood) {
      const totalRemaining = [...deficitMap.values()].reduce((a, b) => a + b, 0);
      if (totalRemaining <= 0) continue;

      for (const site of working.values()) {
        const capUnits = buildableUnits(site, goodId);
        if (capUnits <= 0) continue;
        if (GOOD_TIER_BY_KEY[goodId] !== 0 && !inputsAvailable(goodId, site, reachableSurplusGoods)) continue;

        const perUnit = OUTPUT_PER_UNIT[goodId] ?? 0;
        if (perUnit <= 0) continue;

        // Score: allocate this site's output capacity to its reachable structural deficits,
        // nearest-first, summing allocated ÷ routeCost (capacity + proximity, each once).
        let capOutput = capUnits * perUnit;
        const reachable = [...deficitMap.entries()]
          .map(([sysId, short]) => ({ sysId, short, cost: routeCost(site.systemId, sysId) }))
          .filter((r): r is { sysId: string; short: number; cost: number } => r.cost !== null && r.cost > 0)
          .sort((a, b) => a.cost - b.cost);
        if (reachable.length === 0) continue;

        // Score reflects full reachable capacity; the per-iteration budget cap is applied to wantUnits below, not to the score (greedy re-scores each pass).
        let score = 0;
        let servedOutput = 0;
        for (const r of reachable) {
          if (capOutput <= 0) break;
          const take = Math.min(capOutput, r.short);
          score += take / r.cost;
          servedOutput += take;
          capOutput -= take;
        }
        if (servedOutput <= 0) continue;

        // Units to build = output needed ÷ per-unit, capped by capacity and budget.
        const wantUnits = Math.min(capUnits, servedOutput / perUnit, budget);
        if (wantUnits <= 0) continue;
        if (!best || score > best.score) best = { site, goodId, score, units: wantUnits };
      }
    }

    if (!best) break;

    // Apply the production build to the working copy + emit it.
    const site = best.site;
    site.buildings[best.goodId] = (site.buildings[best.goodId] ?? 0) + best.units;
    builds.push({ systemId: site.systemId, buildingType: best.goodId, count: best.units });
    budget -= best.units;

    // Co-build housing to keep labourDemand ≤ popCap, bounded by habitable + general space.
    const needLabour = labourDemand(site.buildings);
    const havePopCap = housingPopCap(site.buildings);
    if (needLabour > havePopCap) {
      const housingUnits = (needLabour - havePopCap) / POP_CENTRE_DENSITY;
      const cost = effectiveSpaceCost(HOUSING_TYPE);
      const remainingGeneral = site.generalSpace - generalSpaceUsed(site.buildings);
      const affordable = Math.min(site.habitableSpace, remainingGeneral) / cost;
      const housing = Math.max(0, Math.min(housingUnits, affordable));
      if (housing > 0) {
        site.buildings[HOUSING_TYPE] = (site.buildings[HOUSING_TYPE] ?? 0) + housing;
        builds.push({ systemId: site.systemId, buildingType: HOUSING_TYPE, count: housing });
      }
    }

    // Decrement the served structural demand (nearest-first again) so we don't re-target it.
    const deficitMap = remainingByGood.get(best.goodId);
    if (deficitMap) {
      let producedOutput = best.units * (OUTPUT_PER_UNIT[best.goodId] ?? 0);
      const nearest = [...deficitMap.entries()]
        .map(([sysId, short]) => ({ sysId, short, cost: routeCost(site.systemId, sysId) }))
        .filter((r): r is { sysId: string; short: number; cost: number } => r.cost !== null && r.cost > 0)
        .sort((a, b) => a.cost - b.cost);
      for (const r of nearest) {
        if (producedOutput <= 0) break;
        const take = Math.min(producedOutput, r.short);
        deficitMap.set(r.sysId, r.short - take);
        producedOutput -= take;
      }
    }
  }

  return builds;
}
