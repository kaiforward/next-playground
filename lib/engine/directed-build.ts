/**
 * Pure directed-build planning — zero DB dependency. Two-pass faction build planner:
 * (1) Proactive housing pass — housing leads population, building ahead of the
 *     habitable cap at fed-and-calm systems before industry claims the space.
 * (2) Demand-pulled, labour-gated industry pass — finds structural deficits (a
 *     deficit with no reachable surplus) and allocates production capacity, capped
 *     to what the already-resident population can staff (no co-built housing here).
 * The processor maps DB/sim rows into BuildSystemState and applies the returned PlannedBuild[].
 */
import type { ResourceVector } from "@/lib/types/game";
import { DIRECTED_BUILD } from "@/lib/constants/directed-build";
import { classifyMarketState, surplusDrawable, type RouteCost } from "@/lib/engine/directed-logistics";
import { clamp } from "@/lib/utils/math";
import { dissatisfaction } from "@/lib/engine/population";
import { GOOD_TIER_BY_KEY } from "@/lib/constants/goods";
import { BUILDING_TYPES, OUTPUT_PER_UNIT, effectiveSpaceCost, HOUSING_TYPE, POP_CENTRE_DENSITY, labourTotal } from "@/lib/constants/industry";
import { GOOD_RECIPES } from "@/lib/constants/recipes";
import { labourDemand, housingPopCap } from "@/lib/engine/industry";

/** Market state for one good at one system — the build planner's per-good input. */
export interface BuildGoodState {
  goodId: string;
  stock: number;
  targetStock: number;
  /** Total local demand rate (civilian + industrial); severity weight + the self-supply gate (vs production). */
  demand: number;
  /**
   * Local production rate of this good. A self-supplier (production ≥ demand) is never a
   * structural deficit — its low standing stock is throughput, not need (mirrors the logistics
   * matcher's self-supply gate). Optional for engine-test fixtures; the live/sim path always
   * supplies it via toGoodMarketStates (a GoodMarketState, which carries production).
   */
  production?: number;
}

/** A system's buildable state — markets + the body-derived capacity it can build into. */
export interface BuildSystemState {
  systemId: string;
  factionId: string | null;
  population: number;
  /** Stored unrest integral 0…1 — the "calm" half of the settle gate. */
  unrest: number;
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

/**
 * Stock-coverage dissatisfaction D in [0,1] for one system — the "fed" half of the
 * settle gate. Reuses the population engine's demand-weighted convex fold, with a
 * stock-based satisfaction proxy (stock ÷ targetStock, clamped): the build planner
 * sees standing market state, not the economy's per-tick delivered/demanded flow, so
 * a good sitting at or above its days-of-supply anchor reads as satisfied.
 */
export function supplyDissatisfaction(goods: BuildGoodState[]): number {
  return dissatisfaction(
    goods.map((g) => ({
      satisfaction: g.targetStock > 0 ? clamp(g.stock / g.targetStock, 0, 1) : 1,
      demanded: Math.max(0, g.demand),
    })),
  );
}

/** Settle gate: a system grows housing only when well-supplied (D ≤ D_SETTLE) and calm (unrest ≤ UNREST_SETTLE). */
export function fedAndCalm(sys: BuildSystemState): boolean {
  return (
    supplyDissatisfaction(sys.goods) <= DIRECTED_BUILD.D_SETTLE &&
    sys.unrest <= DIRECTED_BUILD.UNREST_SETTLE
  );
}

/**
 * Additional housing units a site can build before hitting its physical bounds: the
 * habitable subset of space (minus the housing already standing) and the remaining
 * general space (housing competes with factories for it), in housing units. Never
 * negative. Mirrors the seeder's habitable bound.
 */
export function habitableHousingHeadroom(sys: BuildSystemState): number {
  const cost = effectiveSpaceCost(HOUSING_TYPE);
  if (cost <= 0) return 0;
  const housing = sys.buildings[HOUSING_TYPE] ?? 0;
  const remainingGeneral = sys.generalSpace - generalSpaceUsed(sys.buildings);
  const remainingHabitable = sys.habitableSpace - housing * cost;
  return Math.max(0, Math.min(remainingHabitable, remainingGeneral) / cost);
}

/**
 * Proactive housing units to build at a site this cycle: paced to keep popCap a
 * SETTLE_MARGIN ahead of population, never past the habitable headroom. Returns 0
 * when the site is not fed-and-calm or already at its habitable cap. Housing leads —
 * it creates the popCap headroom the (untouched) population logistic then fills.
 */
export function plannedHousingUnits(sys: BuildSystemState): number {
  if (!fedAndCalm(sys)) return 0;
  const headroom = habitableHousingHeadroom(sys);
  if (headroom <= 0) return 0;
  const popProvided = BUILDING_TYPES[HOUSING_TYPE]?.popProvided ?? POP_CENTRE_DENSITY;
  if (popProvided <= 0) return 0;
  const housing = sys.buildings[HOUSING_TYPE] ?? 0;
  const currentPopCap = housingPopCap(sys.buildings);
  const habitableCapPop = (housing + headroom) * popProvided;
  const pop = Math.max(0, sys.population);
  const targetPopCap = Math.min(habitableCapPop, pop * (1 + DIRECTED_BUILD.SETTLE_MARGIN));
  const wantUnits = Math.max(0, (targetPopCap - currentPopCap) / popProvided);
  return Math.min(wantUnits, headroom);
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
 * of its good can reach it (routeCost(surplus, deficit) non-null). A self-supplier
 * (production ≥ demand) is never a deficit sink — its low standing stock is throughput,
 * not need — so building it more capacity is skipped (mirrors the logistics matcher's
 * self-supply gate; without it the planner over-builds goods a system already makes).
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
      if (c.kind === "deficit" && c.shortfall > 0 && (g.production ?? 0) < g.demand) {
        deficits.push({ systemId: s.systemId, goodId: g.goodId, shortfall: c.shortfall, demand: g.demand });
      } else if (surplusDrawable(g.stock, g.targetStock, g.demand, g.production ?? 0) > 0) {
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

/**
 * A tier-1+ site is build-eligible this cycle only when every recipe input is either produced
 * locally or held as a surplus at a system REACHABLE FROM THE SITE. The factory's inputs arrive
 * via logistics, which is route-cost bounded, so a surplus that merely exists somewhere in the
 * faction is not enough — it must be deliverable to this site (routeCost(source, site) non-null).
 */
function inputsAvailable(
  goodId: string,
  site: BuildSystemState,
  surplusSystemsByGood: Map<string, string[]>,
  routeCost: RouteCost,
): boolean {
  const recipe = GOOD_RECIPES[goodId];
  if (!recipe) return true; // tier-0 has no recipe
  return Object.keys(recipe).every((input) => {
    if ((site.buildings[input] ?? 0) > 0) return true;
    const sources = surplusSystemsByGood.get(input);
    return sources !== undefined && sources.some((su) => routeCost(su, site.systemId) !== null);
  });
}

/** One candidate build action: site S can produce `goodId` to serve nearby structural deficits. */
interface BuildOpportunity {
  systemId: string;
  goodId: string;
  perUnit: number;
  /** Structural-deficit systems of this good reachable from the site, nearest first (cost > 0). */
  reachable: Array<{ sysId: string; cost: number }>;
  /** Initial allocation score (served ÷ route cost) — used to rank opportunities once. */
  score: number;
}

/**
 * Greedy demand-pulled build planner for ONE faction's systems. Budget = Σ system
 * generation, spent as building units. For each structural-gap good, score candidate
 * sites by the reachable structural demand they can serve (capacity-bounded,
 * nearest-first), then spend the budget on the highest-scoring opportunities.
 *
 * Each (site, good) opportunity's route-cost-sorted reachable deficits are static, so
 * they are computed ONCE and the budget is spent in a single descending-score pass —
 * never re-scanning every site×good per build. A faction owning hundreds of systems
 * would otherwise cost O(builds × sites × deficits) and take tens of seconds at 10k.
 */
export function planFactionBuilds(
  systems: BuildSystemState[],
  routeCost: RouteCost,
): PlannedBuild[] {
  let budget = 0;
  for (const s of systems) budget += systemBuildGeneration(s.population);
  if (budget <= 0) return [];

  // Mutable per-system working copy so capacity/labour reflect builds made this pass.
  const working = new Map<string, BuildSystemState>();
  for (const s of systems) working.set(s.systemId, { ...s, buildings: { ...s.buildings } });

  const builds: PlannedBuild[] = [];

  // ── Pass 1: proactive housing (housing leads population). ──
  // Build housing toward the habitable cap wherever a system is fed and calm, paced a
  // margin ahead of its current population. Housing draws general space, so it runs
  // before industry — habitable land is housing's by right; factories take what's left.
  for (const site of working.values()) {
    if (budget <= 0) break;
    const want = plannedHousingUnits(site);
    if (want <= 0) continue;
    const units = Math.min(want, budget);
    if (units <= 0) continue;
    site.buildings[HOUSING_TYPE] = (site.buildings[HOUSING_TYPE] ?? 0) + units;
    builds.push({ systemId: site.systemId, buildingType: HOUSING_TYPE, count: units });
    budget -= units;
  }

  // ── Pass 2: labour-gated industry (industry follows the resident workforce). ──
  if (budget <= 0) return builds;

  const structural = findStructuralDeficits(systems, routeCost);
  if (structural.length === 0) return builds;

  // Surplus-holding systems per good — the input-supply side of the tier-1+ gate. A factory's
  // recipe inputs arrive via route-cost-bounded logistics, so the gate checks for a surplus
  // reachable FROM each candidate site (see inputsAvailable), not merely one somewhere in the faction.
  const surplusSystemsByGood = new Map<string, string[]>();
  for (const s of systems) {
    for (const g of s.goods) {
      if (surplusDrawable(g.stock, g.targetStock, g.demand, g.production ?? 0) > 0) {
        const list = surplusSystemsByGood.get(g.goodId) ?? [];
        list.push(s.systemId);
        surplusSystemsByGood.set(g.goodId, list);
      }
    }
  }

  // Remaining structural shortfall per (good → systemId → shortfall).
  const remainingByGood = new Map<string, Map<string, number>>();
  for (const d of structural) {
    const m = remainingByGood.get(d.goodId) ?? new Map<string, number>();
    m.set(d.systemId, (m.get(d.systemId) ?? 0) + d.shortfall);
    remainingByGood.set(d.goodId, m);
  }

  // Precompute every candidate (site, good) opportunity once — the reachable deficit
  // list depends only on static route costs, so building it here (not per-build) keeps
  // the planner near-linear in the faction's system count.
  const opportunities: BuildOpportunity[] = [];
  for (const [goodId, deficitMap] of remainingByGood) {
    const perUnit = OUTPUT_PER_UNIT[goodId] ?? 0;
    if (perUnit <= 0) continue;
    const isTier0 = GOOD_TIER_BY_KEY[goodId] === 0;
    const deficitSystemIds = [...deficitMap.keys()];

    for (const site of working.values()) {
      const capUnits = buildableUnits(site, goodId);
      if (capUnits <= 0) continue;
      if (!isTier0 && !inputsAvailable(goodId, site, surplusSystemsByGood, routeCost)) continue;

      const reachable = deficitSystemIds
        .map((sysId) => ({ sysId, cost: routeCost(site.systemId, sysId) }))
        .filter((r): r is { sysId: string; cost: number } => r.cost !== null && r.cost > 0)
        .sort((a, b) => a.cost - b.cost);
      if (reachable.length === 0) continue;

      // Score: allocate this site's output capacity to its reachable deficits,
      // nearest-first, summing served ÷ route cost (capacity + proximity). Ordering only.
      let capOutput = capUnits * perUnit;
      let score = 0;
      for (const r of reachable) {
        if (capOutput <= 0) break;
        const short = deficitMap.get(r.sysId) ?? 0;
        if (short <= 0) continue;
        const take = Math.min(capOutput, short);
        score += take / r.cost;
        capOutput -= take;
      }
      if (score <= 0) continue;

      opportunities.push({ systemId: site.systemId, goodId, perUnit, reachable, score });
    }
  }

  opportunities.sort((a, b) => b.score - a.score);

  for (const opp of opportunities) {
    if (budget <= 0) break;
    const site = working.get(opp.systemId);
    if (!site) continue;

    const capUnits = buildableUnits(site, opp.goodId);
    if (capUnits <= 0) continue;

    const deficitMap = remainingByGood.get(opp.goodId);
    if (!deficitMap) continue;

    // Output we can usefully place = Σ over reachable remaining shortfalls, capped by capacity.
    let capOutput = capUnits * opp.perUnit;
    let servedOutput = 0;
    for (const r of opp.reachable) {
      if (capOutput <= 0) break;
      const short = deficitMap.get(r.sysId) ?? 0;
      if (short <= 0) continue;
      const take = Math.min(capOutput, short);
      servedOutput += take;
      capOutput -= take;
    }
    if (servedOutput <= 0) continue;

    // Spare-labour gate: a site may add only the production its already-resident
    // population can staff (population − labour already demanded). Housing built this
    // cycle adds no labour now — population fills it over later ticks — so industry
    // follows the people who already live there, never population that doesn't yet exist.
    const labourPerUnit = labourTotal(BUILDING_TYPES[opp.goodId]?.labour ?? { unskilled: 0, skill1: 0, skill2: 0 });
    const spareLabour = Math.max(0, site.population - labourDemand(site.buildings));
    const labourCapUnits = labourPerUnit > 0 ? spareLabour / labourPerUnit : Infinity;

    const wantUnits = Math.min(capUnits, servedOutput / opp.perUnit, budget, labourCapUnits);
    if (wantUnits <= 0) continue;

    // Apply the production build to the working copy + emit it.
    site.buildings[opp.goodId] = (site.buildings[opp.goodId] ?? 0) + wantUnits;
    builds.push({ systemId: site.systemId, buildingType: opp.goodId, count: wantUnits });
    budget -= wantUnits;

    // Decrement the served structural demand (nearest-first) so later opportunities don't re-target it.
    let producedOutput = wantUnits * opp.perUnit;
    for (const r of opp.reachable) {
      if (producedOutput <= 0) break;
      const short = deficitMap.get(r.sysId) ?? 0;
      if (short <= 0) continue;
      const take = Math.min(producedOutput, short);
      deficitMap.set(r.sysId, short - take);
      producedOutput -= take;
    }
  }

  return builds;
}
