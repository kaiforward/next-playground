/**
 * Pure directed-build planning — zero DB dependency. Two-pass faction build planner:
 * (1) Proactive housing pass — housing leads population, building ahead of the
 *     habitable cap at fed-and-calm systems before industry claims the space.
 * (2) Demand-pulled, labour-gated industry pass — finds structural deficits (a
 *     deficit with no reachable surplus) and allocates production capacity, capped
 *     to what the already-resident population can staff (no co-built housing here).
 * The processor maps tick rows into BuildSystemState and applies the returned PlannedBuild[].
 */
import type { ResourceVector } from "@/lib/types/game";
import type { SystemControl, WorldConstructionProject, WorldColonyEstablishProject } from "@/lib/world/types";
import { DIRECTED_BUILD, SPECULATIVE_BASICS } from "@/lib/constants/directed-build";
import { systemDevelopment, type DevelopmentRefs } from "@/lib/engine/development";
import { surplusDrawable, type RouteCost } from "@/lib/engine/directed-logistics";
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
import { workCostPerLevel } from "@/lib/constants/construction";
import {
  colonyValue, factionMissingResources, factionSaturation, unblockedDemandByResource,
  type FactionSystemState, type GoodDeficit, type ColonyValueParams,
} from "@/lib/engine/colonisation-value";
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
   * matcher's self-supply gate). Optional for engine-test fixtures; the tick path always
   * supplies it via toGoodMarketStates (a GoodMarketState, which carries production).
   */
  production?: number;
  /**
   * Persisted consumption satisfaction from the last economy pulse (delivered ÷ demanded, ∈
   * [0,1]; missing ⇒ 1) — supplyDissatisfaction's only input. stock/targetStock stay on this
   * type for the deficit finder and severity weights; they no longer feed the fed-proxy.
   */
  satisfaction?: number;
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

/**
 * Build-side route cost over a bounded-hop distance map. A system reaches ITSELF at `selfCost`
 * (the cheapest positive route, so the planner's served ÷ cost scoring builds local self-supply
 * before export); any other system costs `hops × hopWeight`, or is unreachable (`null`) when it has
 * no entry or lies beyond `maxHops`. An empty `hops` map yields a self-only route (used to seed an
 * isolated homeworld).
 */
export function hopRouteCost(
  hops: Map<string, Map<string, number>>,
  maxHops: number,
  hopWeight: number,
  selfCost: number,
): RouteCost {
  return (from, to) => {
    if (from === to) return selfCost;
    const h = hops.get(from)?.get(to);
    return h === undefined || h > maxHops ? null : h * hopWeight;
  };
}

/**
 * Delivered-flow dissatisfaction D in [0,1] for one system — the "fed" half of
 * the settle gate. Reuses the population engine's demand-weighted convex fold
 * over the economy pulse's persisted per-good satisfaction (delivered ÷
 * demanded — the same measure the needs display reads), so a
 * deliberately-at-comfort exporter with full delivery reads as satisfied.
 * Missing satisfaction (engine-test fixtures, pre-change saves) ⇒ 1.
 */
export function supplyDissatisfaction(goods: BuildGoodState[]): number {
  return dissatisfaction(
    goods.map((g) => ({
      satisfaction: clamp(g.satisfaction ?? 1, 0, 1),
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
 *
 * Whole housing levels are lumpy (one level houses POP_CENTRE_DENSITY), so once occupancy has caught
 * the settle margin (targetPopCap > currentPopCap) the want is rounded UP to at least one whole level.
 * Without that round-up popCap could never ratchet above a small seed: a 1-level colony's margin-ahead
 * want is a fraction of a level, floored to nothing, so it would need population to exceed its own cap
 * (impossible — migration/growth both asymptote to popCap) before earning a 2nd level. Bounded by the
 * physical habitable headroom.
 */
export function plannedHousingUnits(sys: BuildSystemState): number {
  if (!fedAndCalm(sys)) return 0;
  const headroom = habitableHousingHeadroom(sys);
  if (headroom < 1) return 0; // no room for even one whole level
  const popProvided = BUILDING_TYPES[HOUSING_TYPE]?.popProvided ?? POP_CENTRE_DENSITY;
  if (popProvided <= 0) return 0;
  const currentPopCap = housingPopCap(sys.buildings);
  const pop = Math.max(0, sys.population);
  const targetPopCap = pop * (1 + DIRECTED_BUILD.SETTLE_MARGIN);
  if (targetPopCap <= currentPopCap) return 0; // still housing headroom above the settle margin
  const wantUnits = (targetPopCap - currentPopCap) / popProvided;
  return Math.min(Math.floor(headroom), Math.max(1, Math.ceil(wantUnits)));
}

/** A rate deficit (production < demand) with no reachable surplus of its good — the build target. */
export interface StructuralDeficit {
  systemId: string;
  goodId: string;
  /** The per-tick flow to close = demand − production (> 0). Placement sizes capacity to this rate. */
  rateDeficit: number;
  demand: number;
}

/**
 * Find the rate deficits (production < demand) reachable supply cannot cover, netting the coverage
 * FLOW rather than testing mere existence (docs/planned/economy-colony-bootstrapping.md §3.1). A
 * good's build target is its RATE deficit (demand − production), not a days-of-supply stock shortfall:
 * capacity is built to meet the flow (docs/planned/economy-demand-driven-model.md §2), so a full
 * stock buffer does not cancel a structural shortfall. A self-supplier (production ≥ demand) has no
 * rate deficit and is skipped.
 *
 * Cancellation is flow-aware. An exporter's spare is its sustainable export RATE `production − demand`
 * (not a stock pile — a neighbour merely holding and draining stock has non-positive spare, so it never
 * cancels a deficit; logistics still ships that transient stock while local capacity comes up). Per
 * good, the reachable exporters' total spare is netted across all reachable deficits at once —
 * `coveredFraction = min(1, Σ spare / Σ reachable-deficit)` (first cut per §7.6) — so one exporter's
 * spare cannot fully cover two competing colonies. Each reachable deficit's residual
 * `rateDeficit × (1 − coveredFraction)` stays structural → buildable locally; a deficit with no
 * reachable exporter stays fully structural. Building serves one's own demand (self = cheapest route)
 * for whatever reachable supply cannot actually deliver.
 *
 * O(goods · systems) for the spare/deficit sums plus the same per-deficit reachability scan the
 * existence test already did — cheap enough for the per-pulse planner.
 */
export function findStructuralDeficits(
  systems: BuildSystemState[],
  routeCost: RouteCost,
): StructuralDeficit[] {
  const deficits: Array<{ systemId: string; goodId: string; rateDeficit: number; demand: number }> = [];
  // Reachable rate exporters per good, each carrying its spare export rate (production − demand > 0).
  const exportersByGood = new Map<string, Array<{ systemId: string; spare: number }>>();
  const spareByGood = new Map<string, number>();

  for (const s of systems) {
    for (const g of s.goods) {
      const spare = (g.production ?? 0) - g.demand;
      if (spare < 0) {
        deficits.push({ systemId: s.systemId, goodId: g.goodId, rateDeficit: -spare, demand: g.demand });
      } else if (spare > 0) {
        const list = exportersByGood.get(g.goodId) ?? [];
        list.push({ systemId: s.systemId, spare });
        exportersByGood.set(g.goodId, list);
        spareByGood.set(g.goodId, (spareByGood.get(g.goodId) ?? 0) + spare);
      }
    }
  }

  // First pass: mark which deficits have any reachable exporter, and sum the reachable demand per good
  // — the denominator the shared spare is netted across.
  const reachableDeficitByGood = new Map<string, number>();
  const flagged = deficits.map((d) => {
    const reachable = (exportersByGood.get(d.goodId) ?? []).some((e) => routeCost(e.systemId, d.systemId) !== null);
    if (reachable) reachableDeficitByGood.set(d.goodId, (reachableDeficitByGood.get(d.goodId) ?? 0) + d.rateDeficit);
    return { d, reachable };
  });

  // Second pass: an unreachable deficit is fully structural; a reachable one keeps its uncovered residual.
  const structural: StructuralDeficit[] = [];
  for (const { d, reachable } of flagged) {
    if (!reachable) {
      structural.push(d);
      continue;
    }
    const reachableDeficit = reachableDeficitByGood.get(d.goodId) ?? 0;
    const coveredFraction = reachableDeficit > 0 ? Math.min(1, (spareByGood.get(d.goodId) ?? 0) / reachableDeficit) : 0;
    const residual = d.rateDeficit * (1 - coveredFraction);
    if (residual > 0) structural.push({ systemId: d.systemId, goodId: d.goodId, rateDeficit: residual, demand: d.demand });
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
export function extractorsOnResource(buildings: Record<string, number>, resource: string): number {
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
 * The additional local production an undeveloped system should stand up as a self-supply FLOOR of a
 * basic it has a deposit for, beyond what reactive builds already add (§3.2 / §7.7). The floor is
 * `(1 − systemDevelopment) × SPECULATIVE_FLOOR × localDemand` — strongest on a raw colony, fading to
 * nothing as it matures — netted against the good's current local production and the
 * `structuralResidual` (the flow-aware uncovered demand already queued for local build). Zero for a
 * non-basic, a good with no local deposit or demand, a matured system, or when reactive builds already
 * reach the floor. Bounded ≤ local demand, so it is a floor, never export.
 */
export function speculativeFloorExtra(
  site: BuildSystemState,
  goodId: string,
  structuralResidual: number,
  refs: DevelopmentRefs,
): number {
  if (!SPECULATIVE_BASICS.includes(goodId)) return 0;
  if (buildableUnits(site, goodId) < 1) return 0; // no local deposit slots to build into
  const market = site.goods.find((g) => g.goodId === goodId);
  if (!market || market.demand <= 0) return 0;
  const floorFraction = (1 - systemDevelopment(site, refs)) * DIRECTED_BUILD.SPECULATIVE_FLOOR;
  if (floorFraction <= 0) return 0;
  return Math.max(0, floorFraction * market.demand - (market.production ?? 0) - structuralResidual);
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

/** One whole-level order within a proposal bundle: `levels` of `buildingType`. */
export interface ProposalItem {
  buildingType: string;
  levels: number;
}

/**
 * A funding proposal — the unit that carries an ROI (docs/planned/economy-colonisation-cost.md §4).
 * A BuildProposal BUNDLES a production level-set with the academies/complex that GATE it, in `items`
 * held gate-first (complex → schools → institutes → production); a housing proposal is a single
 * housing item. ROI = `value` (served demand-rate the production covers) ÷ `work` (the WHOLE bundle's
 * level work), so an enabler — an academy/complex with no served demand of its own — raises the
 * denominator without touching the numerator: the bundle funds gate-first at the production's ROI and
 * the school never ranks below the factory it staffs. (PR3 adds a single-item ColonyProposal.)
 */
export interface BuildProposal {
  kind: "build";
  factionId: string;
  systemId: string;
  /** Housing leads population (proactive substrate, no served-demand ROI); industry ranks by ROI. */
  role: "housing" | "industry";
  /** Whole-level orders in gate-first funding order. */
  items: ProposalItem[];
  /** Served demand-rate this bundle's production covers — the ROI numerator (0 for housing). */
  value: number;
  /** Σ over items of `levels × workCostPerLevel` — the ROI denominator. */
  work: number;
}

/** The proposal union the decision layer emits — build bundles and colony-establishments, ranked on one pool. */
export type Proposal = BuildProposal | ColonyProposal;

/** A bundle before its faction is attached (the planner works per system; faction is a later join). */
interface PlannedBundle {
  systemId: string;
  role: "housing" | "industry";
  items: ProposalItem[];
  value: number;
  work: number;
}

/**
 * Greedy demand-pulled build planner for ONE faction's systems, emitting funding BUNDLES. Same
 * decision logic as before — proposes builds toward the physical ceilings only (capacity, spare
 * labour, whole-level validity); the construction pool is the sole speed meter — but each committed
 * build now leaves as a `PlannedBundle` carrying its served demand (`value`) and total level work
 * (`work`) so the funding stage can rank bundles by ROI. A housing build is a one-item bundle; an
 * industry opportunity is a bundle of [complex?, schools?, institutes?, production], gate-first.
 *
 * Each (site, good) opportunity's route-cost-sorted reachable deficits are static, so they are
 * computed ONCE and committed in a single descending-score pass — never re-scanning every site×good
 * per build.
 */
function planFactionBundles(
  systems: BuildSystemState[],
  routeCost: RouteCost,
  refs: DevelopmentRefs,
): PlannedBundle[] {
  // Mutable per-system working copy so capacity/labour reflect builds made this pass.
  // Only developed systems can host builds — unclaimed and controlled (outpost-tier)
  // systems are skipped here, gating both the housing and industry passes in one place.
  // Deficit/surplus detection below still reads all `systems`.
  const working = new Map<string, BuildSystemState>();
  for (const s of systems) {
    if (!isEconomicallyActive(s.control)) continue;
    working.set(s.systemId, { ...s, buildings: { ...s.buildings } });
  }

  const bundles: PlannedBundle[] = [];

  // ── Pass 1: proactive housing (housing leads population). ──
  // Build housing toward the habitable cap wherever a system is fed and calm, paced a
  // margin ahead of its current population. Housing draws general space, so it runs
  // before industry — habitable land is housing's by right; factories take what's left.
  for (const site of working.values()) {
    const want = plannedHousingUnits(site);
    if (want <= 0) continue;
    // Whole levels only: you commit a whole housing level or none. A sub-level want waits.
    const levels = Math.floor(want);
    if (levels < 1) continue;
    site.buildings[HOUSING_TYPE] = (site.buildings[HOUSING_TYPE] ?? 0) + levels;
    bundles.push({
      systemId: site.systemId,
      role: "housing",
      items: [{ buildingType: HOUSING_TYPE, levels }],
      value: 0, // proactive substrate — no served-demand ROI; the funding stage leads housing anyway
      work: levels * workCostPerLevel(HOUSING_TYPE),
    });
  }

  // ── Pass 2: labour-gated industry (industry follows the resident workforce). ──
  const structural = findStructuralDeficits(systems, routeCost);

  // Remaining structural shortfall per (good → systemId → shortfall).
  const remainingByGood = new Map<string, Map<string, number>>();
  for (const d of structural) {
    const m = remainingByGood.get(d.goodId) ?? new Map<string, number>();
    m.set(d.systemId, (m.get(d.systemId) ?? 0) + d.rateDeficit);
    remainingByGood.set(d.goodId, m);
  }

  // Speculative local-basics floor (§3.2): an undeveloped system stands up a bounded floor of its own
  // tier-0 extraction of un-repurposable basics it imports, scaled by (1 − development). Added onto the
  // remaining shortfall so the same opportunity machinery builds and ROI-ranks it (self-supply wins on
  // route cost); nets against the flow-aware residual so it only tops up what reactive builds miss. This
  // runs even with no structural deficit — the import-everything case is exactly what it exists to fix.
  for (const site of working.values()) {
    for (const goodId of SPECULATIVE_BASICS) {
      const residual = remainingByGood.get(goodId)?.get(site.systemId) ?? 0;
      const extra = speculativeFloorExtra(site, goodId, residual, refs);
      if (extra <= 0) continue;
      const m = remainingByGood.get(goodId) ?? new Map<string, number>();
      m.set(site.systemId, (m.get(site.systemId) ?? 0) + extra);
      remainingByGood.set(goodId, m);
    }
  }

  if (remainingByGood.size === 0) return bundles;

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

    // Labour gate: a site may build up to ONE production-unit AHEAD of what its resident population
    // fully staffs. Population is a single undifferentiated pool staffing ALL labour (unskilled +
    // skill1 + skill2 heads); skill1/skill2 are academy-licensed ceilings on that pool, not separate
    // head pools. The one-unit lead is decay-safe — infrastructure decay only sheds a level when a
    // WHOLE unit is idle (floor(count − used) ≥ 1, see infrastructure-decay.ts) — and it is what lets a
    // small colony stand up its FIRST extractor (whose jobs then pull migration) instead of deadlocking
    // on a full-staffing gate. Housing built this cycle adds no labour now — industry follows the
    // people already resident, never population that doesn't yet exist.
    const remainingGeneral = site.generalSpace - generalSpaceUsed(site.buildings);
    // Tier-0 extractors sit on dedicated deposit slots, not general space (mirrors generalSpaceUsed).
    const prodSpacePerUnit = GOOD_TIER_BY_KEY[opp.goodId] === 0 ? 0 : effectiveSpaceCost(opp.goodId);
    // Full per-unit head count (unskilled + skill1 + skill2) — population staffs the WHOLE labour
    // draw of a production unit, not just its unskilled slice.
    const prodLabourPerUnit = labourTotal(BUILDING_TYPES[opp.goodId]?.labour ?? { unskilled: 0, skill1: 0, skill2: 0 });

    // Whole-level convergence: the desired production floored to whole levels (you commission whole
    // levels), then the academies and complex that GATE it rounded UP — a gate must fully exist to
    // license/anchor the production it serves (a fractional school licenses nobody). The largest
    // whole-level count whose production + gates fit the general space and spare labour is found by
    // binary search: the fit is monotone (more levels ⇒ more space + labour + academy/complex), so a
    // landed level is never unstaffable or over-footprint. Recomputing the lift per candidate level
    // mirrors the fractional planner's convergence on whole levels.
    // Round the served RATE deficit UP to whole levels: capacity is lumpy, so meeting a flow smaller
    // than one level's output still commits one level (the design's accepted overshoot — the excess
    // fills the passive buffer). Flooring here would build NOTHING whenever a system's per-tick demand
    // is below a single building's output, stranding every small consumer. Still capped by physical capacity.
    const maxLevels = Math.min(Math.floor(capUnits), Math.ceil(servedOutput / opp.perUnit));
    if (maxLevels < 1) continue;

    const fitFor = (levels: number) => {
      const a = academyLift(site, opp.goodId, levels);
      const c = complexLift(site, opp.goodId, levels);
      const schools = a.schools > 0 ? Math.ceil(a.schools) : 0;
      const institutes = a.institutes > 0 ? Math.ceil(a.institutes) : 0;
      const complexType = c.complexType;
      const complexLevels = c.count > 0 ? Math.ceil(c.count) : 0;
      const spaceTotal =
        levels * prodSpacePerUnit +
        schools * effectiveSpaceCost(VOCATIONAL_SCHOOL_TYPE) +
        institutes * effectiveSpaceCost(RESEARCH_INSTITUTE_TYPE) +
        (complexType ? complexLevels * effectiveSpaceCost(complexType) : 0);
      const labourNeeded =
        levels * prodLabourPerUnit +
        schools * unskilledPerUnit(VOCATIONAL_SCHOOL_TYPE) +
        institutes * unskilledPerUnit(RESEARCH_INSTITUTE_TYPE) +
        (complexType ? complexLevels * unskilledPerUnit(complexType) : 0);
      // Total labour demand after this build stays STRICTLY within one production-unit of the
      // population, so the lead unit is only ever fractionally idle (< 1 whole unit ⇒ decay-safe; the
      // strict `<` excludes the exact-boundary case that would leave a whole unit idle, and refuses to
      // build at all on a pop-0 world). Gating TOTAL demand — not a max(0)-floored spare — bounds the
      // lead across opportunities so it can't stack into multi-unit under-staffing.
      const fits = spaceTotal <= remainingGeneral &&
        labourDemand(site.buildings) + labourNeeded < site.population + prodLabourPerUnit;
      return { fits, schools, institutes, complexType, complexLevels };
    };

    let lo = 1;
    let hi = maxLevels;
    let prodLevels = 0;
    let schools = 0;
    let institutes = 0;
    let complexLevels = 0;
    let complexType: string | undefined;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const f = fitFor(mid);
      if (f.fits) {
        prodLevels = mid;
        schools = f.schools;
        institutes = f.institutes;
        complexType = f.complexType;
        complexLevels = f.complexLevels;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (prodLevels < 1) continue;

    // Apply the complex first (any later opportunity at this site sees the buff it grants), then
    // academies (raise the ceiling on the working copy), then the production — gate before production
    // in both the working copy and the bundle's item order, so the funding queue funds the gate first.
    const items: ProposalItem[] = [];
    let work = 0;
    if (complexType && complexLevels > 0) {
      site.buildings[complexType] = (site.buildings[complexType] ?? 0) + complexLevels;
      items.push({ buildingType: complexType, levels: complexLevels });
      work += complexLevels * workCostPerLevel(complexType);
    }

    for (const [type, count] of [
      [VOCATIONAL_SCHOOL_TYPE, schools] as const,
      [RESEARCH_INSTITUTE_TYPE, institutes] as const,
    ]) {
      if (count <= 0) continue;
      site.buildings[type] = (site.buildings[type] ?? 0) + count;
      items.push({ buildingType: type, levels: count });
      work += count * workCostPerLevel(type);
    }

    site.buildings[opp.goodId] = (site.buildings[opp.goodId] ?? 0) + prodLevels;
    items.push({ buildingType: opp.goodId, levels: prodLevels });
    work += prodLevels * workCostPerLevel(opp.goodId);

    // Decrement the served structural demand (nearest-first) so later opportunities don't re-target
    // it, and accumulate what this bundle actually serves — its ROI numerator (`value`).
    let producedOutput = prodLevels * perUnit;
    let value = 0;
    for (const r of opp.reachable) {
      if (producedOutput <= 0) break;
      const short = deficitMap.get(r.sysId) ?? 0;
      if (short <= 0) continue;
      const take = Math.min(producedOutput, short);
      deficitMap.set(r.sysId, short - take);
      producedOutput -= take;
      value += take;
    }

    bundles.push({ systemId: site.systemId, role: "industry", items, value, work });
  }

  return bundles;
}

/**
 * Flat build view of the planner — the same decisions `planFactionBundles` makes, ungrouped, in
 * emission order (housing pass, then industry opportunities by descending score). Kept as the stable
 * unit-test surface for the planner's *what-gets-built* logic, independent of funding order.
 */
export function planFactionBuilds(
  systems: BuildSystemState[],
  routeCost: RouteCost,
  refs: DevelopmentRefs,
): PlannedBuild[] {
  return planFactionBundles(systems, routeCost, refs).flatMap((b) =>
    b.items.map((i) => ({ systemId: b.systemId, buildingType: i.buildingType, count: i.levels })),
  );
}

/**
 * The auto queue policy: emit the whole-level PROPOSALS a faction should fund this pulse. It runs the
 * same ceiling logic as `planFactionBuilds` (proactive housing → labour-gated industry, with
 * academy/complex co-builds), but treats each system's **effective current** capacity as its built
 * levels PLUS the levels already in flight (`openProjects`) — so a level already under construction
 * counts as committed and is never proposed twice. Each returned `BuildProposal` bundles its
 * gate-first items with the served demand (`value`) and total work the funding stage ranks by; the
 * order here is the planner's natural one (housing, then industry by score) — the funding stage
 * (`orderProposals`) does the ROI re-ordering.
 *
 * The throughput pool (not this planner) meters how fast the queue drains; this only decides WHAT to
 * commit, bounded by the physical ceilings the effective-current capacity encodes.
 */
export function planFactionProposals(
  systems: BuildSystemState[],
  routeCost: RouteCost,
  openProjects: WorldConstructionProject[],
  refs: DevelopmentRefs,
): BuildProposal[] {
  // In-flight levels per (system, buildingType) — the "already committed" capacity. Only build
  // projects contribute building levels here; a colony-establish carries no in-flight levels at a
  // developed system (its own in-flight dedup is handled by planFactionColonyProposals).
  const queuedBySystem = new Map<string, Record<string, number>>();
  for (const p of openProjects) {
    if (p.kind !== "build") continue;
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
  const proposals: BuildProposal[] = [];
  for (const b of planFactionBundles(augmented, routeCost, refs)) {
    const factionId = factionBySystem.get(b.systemId);
    // Only faction-owned systems can be developed (the build gate), so a bundle always has a faction;
    // the guard both narrows the type and skips the impossible independent-system case.
    if (factionId == null) continue;
    proposals.push({ kind: "build", factionId, systemId: b.systemId, role: b.role, items: b.items, value: b.value, work: b.work });
  }
  return proposals;
}

// ── Colony-establish proposals (the second consumer of the decision → gate → pace pipeline) ──────────

/** A controlled system a faction could settle: its substrate + the developed seed source (from hop data). */
export interface ColonyEstablishCandidate {
  systemId: string;
  habitableSpace: number;
  generalSpace: number;
  slotCap: ResourceVector;
  /** Nearest developed same-faction system — the conserved seed source (non-null; the provider drops sourceless). */
  sourceSystemId: string;
}

/** Tunable colony inputs: the valuation coefficients plus the establish cost, seed base, and habitable floor. */
export interface ColonyEstablishParams extends ColonyValueParams {
  /** Base settle work before the bundled seed-housing's build cost (COLONISATION.COLONY_ESTABLISH_WORK). */
  establishWork: number;
  /** Starter colony population, land-capped at proposal (EXPANSION.COLONY_SEED_POP). */
  seedPop: number;
  /** Minimum habitable space to consider a controlled system a colony candidate (EXPANSION.DEVELOP_HABITABLE_FLOOR). */
  habitableFloor: number;
  /** Weight on the seed-pop opportunity cost netted off colony value (COLONISATION.SEED_POP_COST_WEIGHT). */
  popCostWeight: number;
  /** Settler supply (drawable pop/pulse) a faction must have per hungry colony to open another — the anti-sprawl gate (COLONISATION.MIN_SETTLER_SUPPLY). */
  minSettlerSupply: number;
  /** Fraction of a source's staffed workers drawable as settlers (mirrors MIGRATION_PARAMS.employedLeakFraction). */
  employedLeakFraction: number;
}

/**
 * A colony-establish proposal — a single-item member of the `Proposal` union carrying its `colonyValue`
 * (the ROI numerator, on the build-comparable demand-rate axis) and `establishWork` (the denominator). It
 * interleaves with build bundles by ROI in `orderProposals`; the processor expands a funded one into a
 * `colony_establish` project. `seedPop`/`housingLevels` are fixed here (sized to the candidate's land).
 */
export interface ColonyProposal {
  kind: "colony_establish";
  factionId: string;
  /** The controlled system being settled. */
  systemId: string;
  /** Nearest developed same-faction system the seed transfers from (fixed at proposal). */
  sourceSystemId: string;
  /** Land-sized seed: min(COLONY_SEED_POP, whole-level habitable cap). */
  seedPop: number;
  /** Housing bundled with the establishment (houses the seed pop; ≤ whole-level habitable capacity). */
  housingLevels: number;
  /** colonyValue(c) — the ROI numerator. */
  value: number;
  /** COLONY_ESTABLISH_WORK + housingLevels × housing level-work — the ROI denominator. */
  work: number;
}

/**
 * Faction-level rate deficit per good = Σ over developed systems of max(0, demand − production). The
 * `U` (unblocking-value) input to colony scoring: a missing deposit's worth is mostly the DOWNSTREAM
 * demand it gates, so we hand the raw per-good deficits to `unblockedDemandByResource` to attribute
 * fractionally across the missing resources in each good's recipe closure. A self-supplied good (no
 * deficit) contributes nothing.
 */
export function factionGoodDeficits(developed: BuildSystemState[]): GoodDeficit[] {
  const byGood = new Map<string, number>();
  for (const s of developed) {
    for (const g of s.goods) {
      const deficit = g.demand - (g.production ?? 0);
      if (deficit > 0) byGood.set(g.goodId, (byGood.get(g.goodId) ?? 0) + deficit);
    }
  }
  return [...byGood].map(([goodId, rateDeficit]) => ({ goodId, rateDeficit }));
}

/** Seed + bundled-housing sizing for a colony at `habitableSpace` — the planner's whole-level rule,
 *  shared with the player's direct-colony verb so both order identical projects. Null = the site
 *  can't hold one whole housing level (not viable). */
export interface ColonySizing { seedPop: number; housingLevels: number; work: number }

export function sizeColonyEstablish(
  habitableSpace: number,
  params: Pick<ColonyEstablishParams, "seedPop" | "establishWork">,
): ColonySizing | null {
  const housingCost = effectiveSpaceCost(HOUSING_TYPE);
  const maxHousingLevels = housingCost > 0 ? Math.floor(Math.max(0, habitableSpace) / housingCost) : 0;
  const habitableCap = maxHousingLevels * POP_CENTRE_DENSITY;
  const seedPop = Math.min(params.seedPop, habitableCap);
  const housingLevels = Math.min(maxHousingLevels, Math.ceil(seedPop / POP_CENTRE_DENSITY));
  if (housingLevels < 1 || seedPop <= 0) return null;
  return { seedPop, housingLevels, work: params.establishWork + housingLevels * workCostPerLevel(HOUSING_TYPE) };
}

/**
 * Emit a colony-establish proposal for each controlled candidate above the ROI floor, scored on the same
 * demand-rate axis as a build (docs/planned/economy-colonisation-cost.md §3). Faction-level aggregates
 * (territory saturation σ, and the unmet demand each missing resource unblocks) are computed once from the
 * faction's DEVELOPED systems; each candidate is then valued with `colonyValue` and sized to its land —
 * seed capped to the whole-level habitable capacity and housing sized to house it, so the landed colony has
 * `popCap ≥ seedPop` (viable by construction). There is NO per-pulse cap: every eligible candidate is
 * proposed; the pool decides which advance (a proposal persists as an in-flight project only once funded —
 * enforced by the processor's persist-if-funded). A candidate already being established (open project) or
 * below the habitable floor / lacking a whole housing level is skipped. The `Map`/`Set` aggregates are
 * transient — nothing here reaches `World` state.
 */
export function planFactionColonyProposals(
  factionId: string,
  developed: BuildSystemState[],
  candidates: ColonyEstablishCandidate[],
  openColonyProjects: WorldColonyEstablishProject[],
  params: ColonyEstablishParams,
): ColonyProposal[] {
  if (candidates.length === 0) return [];

  const factionSystems: FactionSystemState[] = developed.map((s) => ({
    buildings: s.buildings, habitableSpace: s.habitableSpace, slotCap: s.slotCap,
  }));
  const missing = factionMissingResources(factionSystems);
  const sigma = factionSaturation(factionSystems);
  const unblocked = unblockedDemandByResource(factionGoodDeficits(developed), missing);

  // Seed sources are developed systems — look them up to price the seed's forgone output (below).
  const bySystemId = new Map(developed.map((s) => [s.systemId, s]));

  const inFlight = new Set(openColonyProjects.map((p) => p.systemId));

  const proposals: ColonyProposal[] = [];
  for (const c of candidates) {
    if (inFlight.has(c.systemId)) continue;                 // already being established
    if (c.habitableSpace < params.habitableFloor) continue; // DEVELOP_HABITABLE_FLOOR gate stands

    // Land-sized seed + bundled housing, on WHOLE housing levels so popCap ≥ seedPop exactly (no rounding
    // gap): seed capped to the whole-level habitable capacity; housing sized to house it, land-bounded.
    const sizing = sizeColonyEstablish(c.habitableSpace, params);
    if (sizing === null) continue; // no whole housing level → not viable, skip
    const { seedPop, housingLevels, work } = sizing;

    // Seed-population opportunity cost (§7.3): charge the source's forgone output for the part of the
    // seed that must come from STAFFED workers — idle labour is ≈ free, so founding prefers a job-short
    // source and a healthy core stops bleeding pop. Netted onto the benefit side, keeping `work` a pure
    // construction-points denominator (no invented exchange rate; the cost is in the same output units
    // as `value`). `outputPerWorker` is the source's real output density, so poaching from a dense
    // homeworld costs more than from a sparse frontier — "forgone output, not a flat number".
    const source = bySystemId.get(c.sourceSystemId);
    let popCost = 0;
    if (source) {
      const sourceSpare = Math.max(0, source.population - labourDemand(source.buildings));
      const employedSeed = Math.max(0, seedPop - sourceSpare);
      if (employedSeed > 0) {
        const staffed = Math.max(1, Math.min(Math.max(0, source.population), labourDemand(source.buildings)));
        let output = 0;
        for (const g of source.goods) output += Math.max(0, g.production ?? 0);
        popCost = params.popCostWeight * employedSeed * (output / staffed);
      }
    }
    const value = colonyValue(c, unblocked, sigma, params) - popCost;
    if (value <= 0) continue; // net-negative — the labour it would drain outweighs the colony's worth

    proposals.push({
      kind: "colony_establish", factionId, systemId: c.systemId,
      sourceSystemId: c.sourceSystemId, seedPop, housingLevels, value, work,
    });
  }

  // Settler-supply founding gate: a faction only opens new colonies while it can still deliver its
  // minimum settler supply to each colony it is ALREADY trying to fill (+ each new one). Releasable
  // settler flow this pulse = idle spare labour + the always-on employed leak, summed over developed
  // systems; "hungry" absorbers are developed systems still below their housing cap. Founding is
  // capped to `floor(releasable / minSettlerSupply) − hungry` best-valued candidates, so a faction
  // fills what it has before it sprawls into colonies it can never populate. `minSettlerSupply ≤ 0`
  // disables the gate.
  if (params.minSettlerSupply <= 0 || proposals.length === 0) return proposals;
  let releasable = 0;
  let hungry = 0;
  for (const s of developed) {
    const ld = labourDemand(s.buildings);
    const staffed = Math.min(Math.max(0, s.population), Math.max(0, ld));
    releasable += Math.max(0, s.population - ld) + params.employedLeakFraction * staffed;
    if (s.population < housingPopCap(s.buildings)) hungry++;
  }
  const budget = Math.max(0, Math.floor(releasable / params.minSettlerSupply) - hungry);
  if (budget >= proposals.length) return proposals;
  return [...proposals].sort((a, b) => b.value - a.value).slice(0, budget);
}
