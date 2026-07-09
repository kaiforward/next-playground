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
import type { SystemControl, WorldConstructionProject } from "@/lib/world/types";
import { DIRECTED_BUILD } from "@/lib/constants/directed-build";
import { classifyMarketState, surplusDrawable, type RouteCost } from "@/lib/engine/directed-logistics";
import { isEconomicallyActive } from "@/lib/engine/control";
import { clamp } from "@/lib/utils/math";
import { dissatisfaction } from "@/lib/engine/population";
import { GOOD_TIER_BY_KEY } from "@/lib/constants/goods";
import {
  BUILDING_TYPES, OUTPUT_PER_UNIT, effectiveSpaceCost, HOUSING_TYPE, POP_CENTRE_DENSITY,
  VOCATIONAL_SCHOOL_TYPE, RESEARCH_INSTITUTE_TYPE, SKILL1_PER_SCHOOL, SKILL2_PER_INSTITUTE, labourTotal,
  FAMILY_BY_GOOD, COMPLEX_TYPES, ANCHOR_CAP, ANCHOR_RATED_COVERAGE, ANCHOR_MIN_THROUGHPUT,
} from "@/lib/constants/industry";
import { GOOD_RECIPES } from "@/lib/constants/recipes";
import {
  labourDemand, housingPopCap, skill1Demand, skill2Demand, skill1Cap, skill2Cap,
  familyAnchorBuff, familyThroughput,
} from "@/lib/engine/industry";

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
  /** Three-state ownership: unclaimed frontier → controlled (outpost tier) → developed (build-gate). */
  control: SystemControl;
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

/** Unskilled head count one building of `type` demands (academies + production both draw unskilled). */
function unskilledPerUnit(type: string): number {
  return BUILDING_TYPES[type]?.labour?.unskilled ?? 0;
}

/**
 * Plan the academies a site must add to license `prodUnits` of `goodId`, given its current
 * buildings. Returns the school/institute unit counts (fractional) needed to lift each skill
 * ceiling to cover the post-build skill demand, and the general space + budget + unskilled
 * labour they consume. Tier-0 (no skill draw) → none — academies are never built to unblock a
 * good that doesn't draw on either skill pool.
 */
function academyLift(
  site: BuildSystemState,
  goodId: string,
  prodUnits: number,
): { schools: number; institutes: number; space: number; units: number; unskilled: number } {
  const v = BUILDING_TYPES[goodId]?.labour;
  const tier = GOOD_TIER_BY_KEY[goodId] ?? 0;
  if (!v || tier === 0) return { schools: 0, institutes: 0, space: 0, units: 0, unskilled: 0 };

  const need1 = skill1Demand(site.buildings) + prodUnits * v.skill1 - skill1Cap(site.buildings);
  const need2 = skill2Demand(site.buildings) + prodUnits * v.skill2 - skill2Cap(site.buildings);
  const schools = need1 > 0 ? need1 / SKILL1_PER_SCHOOL : 0;
  const institutes = need2 > 0 ? need2 / SKILL2_PER_INSTITUTE : 0;

  const space =
    schools * effectiveSpaceCost(VOCATIONAL_SCHOOL_TYPE) +
    institutes * effectiveSpaceCost(RESEARCH_INSTITUTE_TYPE);
  const unskilled =
    schools * unskilledPerUnit(VOCATIONAL_SCHOOL_TYPE) +
    institutes * unskilledPerUnit(RESEARCH_INSTITUTE_TYPE);
  return { schools, institutes, space, units: schools + institutes, unskilled };
}

/**
 * Plan the specialisation complex a site should co-build to anchor `goodId`'s family, given the
 * `prodUnits` of it committed this opportunity. Zero lift when: the good is un-familied, the site
 * already holds a complex (cap 1, any family), or the projected family throughput (existing family
 * factories + this build's UNBUFFED output capacity) is below the amortisation floor. Sized to the
 * complex's rated coverage, capped.
 */
function complexLift(
  site: BuildSystemState,
  goodId: string,
  prodUnits: number,
): { complexType?: string; count: number; space: number; units: number; unskilled: number } {
  const zero = { count: 0, space: 0, units: 0, unskilled: 0 };
  const family = FAMILY_BY_GOOD[goodId];
  if (!family) return zero;
  let existing = 0;
  for (const t of COMPLEX_TYPES) existing += site.buildings[t] ?? 0;
  if (existing >= ANCHOR_CAP) return zero;
  const projected = familyThroughput(site.buildings, family) + prodUnits * (OUTPUT_PER_UNIT[goodId] ?? 0);
  if (projected < ANCHOR_MIN_THROUGHPUT) return zero;
  const count = Math.min(ANCHOR_CAP - existing, projected / ANCHOR_RATED_COVERAGE);
  if (count <= 0) return zero;
  return {
    complexType: family.complexType,
    count,
    space: count * effectiveSpaceCost(family.complexType),
    units: count,
    unskilled: count * unskilledPerUnit(family.complexType),
  };
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
  // Only developed systems can host builds — unclaimed and controlled (outpost-tier)
  // systems are skipped here, gating both the housing and industry passes in one place.
  // Deficit/surplus detection below still reads all `systems`.
  const working = new Map<string, BuildSystemState>();
  for (const s of systems) {
    if (!isEconomicallyActive(s.control)) continue;
    working.set(s.systemId, { ...s, buildings: { ...s.buildings } });
  }

  const builds: PlannedBuild[] = [];

  // ── Pass 1: proactive housing (housing leads population). ──
  // Build housing toward the habitable cap wherever a system is fed and calm, paced a
  // margin ahead of its current population. Housing draws general space, so it runs
  // before industry — habitable land is housing's by right; factories take what's left.
  for (const site of working.values()) {
    if (budget <= 0) break;
    const want = plannedHousingUnits(site);
    if (want <= 0) continue;
    // Whole levels only: you commit a whole housing level or none. Floor the paced want to the
    // levels the budget can start this pulse; a sub-level want waits for the next pulse.
    const levels = Math.floor(Math.min(want, budget));
    if (levels < 1) continue;
    site.buildings[HOUSING_TYPE] = (site.buildings[HOUSING_TYPE] ?? 0) + levels;
    builds.push({ systemId: site.systemId, buildingType: HOUSING_TYPE, count: levels });
    budget -= levels;
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
    const baseUnit = OUTPUT_PER_UNIT[goodId] ?? 0;
    if (baseUnit <= 0) continue;
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

      // Score family goods at their buffed per-unit so a seeded-complex site already ranks
      // higher (the snowball): buffed output means more served demand per unit of capacity.
      const perUnit = baseUnit * familyAnchorBuff(site.buildings, goodId);

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

    // Buffed output per unit against the live working copy (reflects any complex already here) —
    // used to convert served demand into produced output when decrementing the deficit.
    const perUnit = (OUTPUT_PER_UNIT[opp.goodId] ?? 0) * familyAnchorBuff(site.buildings, opp.goodId);

    // Spare-LABOUR gate: a site may add only the production (+ any co-built academies) its
    // already-resident population can staff. Population is a single undifferentiated pool that
    // staffs ALL labour (unskilled + skill1 + skill2 heads) — skill1/skill2 are academy-licensed
    // CEILINGS on how much of that pool may work skilled roles, not separate head pools. Housing
    // built this cycle adds no labour now — population fills it over later ticks — so industry
    // follows the people who already live there, never population that doesn't yet exist.
    const spareLabour = Math.max(0, site.population - labourDemand(site.buildings));
    const remainingGeneral = site.generalSpace - generalSpaceUsed(site.buildings);
    // Tier-0 extractors sit on dedicated deposit slots, not general space (mirrors generalSpaceUsed).
    const prodSpacePerUnit = GOOD_TIER_BY_KEY[opp.goodId] === 0 ? 0 : effectiveSpaceCost(opp.goodId);
    // Full per-unit head count (unskilled + skill1 + skill2) — population staffs the WHOLE labour
    // draw of a production unit, not just its unskilled slice.
    const prodLabourPerUnit = labourTotal(BUILDING_TYPES[opp.goodId]?.labour ?? { unskilled: 0, skill1: 0, skill2: 0 });

    // Whole-level convergence: floor the desired production to whole levels (you commission whole
    // levels), then round the academies and complex that GATE it UP — a gate must fully exist to
    // license/anchor the production it serves (a fractional school licenses nobody). Reduce the
    // production levels until production + the whole-level gates fit the budget, the general space,
    // and the spare labour, so a landed level is never unstaffable or over-footprint. Recomputing
    // the lift per candidate level mirrors the fractional planner's convergence on whole levels.
    let prodLevels = Math.floor(Math.min(capUnits, servedOutput / opp.perUnit, budget));
    let schools = 0;
    let institutes = 0;
    let complexLevels = 0;
    let complexType: string | undefined;
    for (; prodLevels >= 1; prodLevels--) {
      const a = academyLift(site, opp.goodId, prodLevels);
      const c = complexLift(site, opp.goodId, prodLevels);
      schools = a.schools > 0 ? Math.ceil(a.schools) : 0;
      institutes = a.institutes > 0 ? Math.ceil(a.institutes) : 0;
      complexType = c.complexType;
      complexLevels = c.count > 0 ? Math.ceil(c.count) : 0;
      const unitsTotal = prodLevels + schools + institutes + complexLevels;
      const spaceTotal =
        prodLevels * prodSpacePerUnit +
        schools * effectiveSpaceCost(VOCATIONAL_SCHOOL_TYPE) +
        institutes * effectiveSpaceCost(RESEARCH_INSTITUTE_TYPE) +
        (complexType ? complexLevels * effectiveSpaceCost(complexType) : 0);
      const labourNeeded =
        prodLevels * prodLabourPerUnit +
        schools * unskilledPerUnit(VOCATIONAL_SCHOOL_TYPE) +
        institutes * unskilledPerUnit(RESEARCH_INSTITUTE_TYPE) +
        (complexType ? complexLevels * unskilledPerUnit(complexType) : 0);
      if (unitsTotal <= budget && spaceTotal <= remainingGeneral && labourNeeded <= spareLabour) break;
    }
    if (prodLevels < 1) continue;

    // Apply the complex first (any later opportunity at this site sees the buff it grants), then
    // academies (raise the ceiling on the working copy), then the production — gate before production
    // in both the working copy and the emitted order, so the funding queue funds the gate first.
    if (complexType && complexLevels > 0) {
      site.buildings[complexType] = (site.buildings[complexType] ?? 0) + complexLevels;
      builds.push({ systemId: site.systemId, buildingType: complexType, count: complexLevels });
      budget -= complexLevels;
    }

    for (const [type, count] of [
      [VOCATIONAL_SCHOOL_TYPE, schools] as const,
      [RESEARCH_INSTITUTE_TYPE, institutes] as const,
    ]) {
      if (count <= 0) continue;
      site.buildings[type] = (site.buildings[type] ?? 0) + count;
      builds.push({ systemId: site.systemId, buildingType: type, count });
      budget -= count;
    }

    site.buildings[opp.goodId] = (site.buildings[opp.goodId] ?? 0) + prodLevels;
    builds.push({ systemId: site.systemId, buildingType: opp.goodId, count: prodLevels });
    budget -= prodLevels;

    // Decrement the served structural demand (nearest-first) so later opportunities don't re-target it.
    let producedOutput = prodLevels * perUnit;
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

/** A whole-level construction order the auto policy wants enqueued (a project before it gets an id). */
export interface DesiredProject {
  factionId: string;
  systemId: string;
  buildingType: string;
  /** Whole levels to build (integer ≥ 1). */
  levels: number;
}

/**
 * The auto queue policy: plan the whole-level construction projects a faction should enqueue this
 * pulse. It runs the same ceiling logic as `planFactionBuilds` (proactive housing → labour-gated
 * industry, with academy/complex co-builds), but treats each system's **effective current** capacity
 * as its built levels PLUS the levels already in flight (`openProjects`) — so a level already under
 * construction counts as committed and is never enqueued twice. The emitted order is gate-first
 * (complex/academies before the production they license), which the funding queue preserves.
 *
 * The throughput pool (not this planner) meters how fast the queue drains; this only decides WHAT to
 * commit, bounded by the physical ceilings the effective-current capacity encodes.
 */
export function planFactionQueue(
  systems: BuildSystemState[],
  routeCost: RouteCost,
  openProjects: WorldConstructionProject[],
): DesiredProject[] {
  // In-flight levels per (system, buildingType) — the "already committed" capacity.
  const queuedBySystem = new Map<string, Record<string, number>>();
  for (const p of openProjects) {
    const rec = queuedBySystem.get(p.systemId) ?? {};
    rec[p.buildingType] = (rec[p.buildingType] ?? 0) + p.levels;
    queuedBySystem.set(p.systemId, rec);
  }

  // Effective-current systems: fold in-flight levels onto the built base so every capacity, space,
  // and labour gate sees the committed state and the planner only proposes what is NOT yet queued.
  const augmented = systems.map((s) => {
    const queued = queuedBySystem.get(s.systemId);
    if (!queued) return s;
    const buildings = { ...s.buildings };
    for (const [type, levels] of Object.entries(queued)) buildings[type] = (buildings[type] ?? 0) + levels;
    return { ...s, buildings };
  });

  const factionBySystem = new Map(systems.map((s) => [s.systemId, s.factionId]));
  const projects: DesiredProject[] = [];
  for (const b of planFactionBuilds(augmented, routeCost)) {
    const factionId = factionBySystem.get(b.systemId);
    // Only faction-owned systems can be developed (the build gate), so a build always has a faction;
    // the guard both narrows the type and skips the impossible independent-system case.
    if (factionId == null) continue;
    projects.push({ factionId, systemId: b.systemId, buildingType: b.buildingType, levels: b.count });
  }
  return projects;
}
