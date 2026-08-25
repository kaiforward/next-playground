/**
 * Pure directed-build planning — zero DB dependency. Two-pass faction build planner:
 * (1) Housing relief pass — a fed system whose occupancy has outrun its housing gets
 *     enough new levels to relieve the crowding, before industry claims the space.
 * (2) Demand-pulled, labour-gated industry pass — finds structural deficits (a
 *     deficit with no reachable surplus) and allocates production capacity, capped
 *     to what the already-resident population can staff (no co-built housing here).
 * The processor maps tick rows into BuildSystemState and applies the returned PlannedBuild[].
 */
import type { ResourceVector } from "@/lib/types/game";
import type { SystemControl, WorldConstructionProject, WorldColonyEstablishProject } from "@/lib/world/types";
import { DIRECTED_BUILD, SPECULATIVE_BASICS } from "@/lib/constants/directed-build";
import { DIRECTED_LOGISTICS } from "@/lib/constants/directed-logistics";
import { systemDevelopment, type DevelopmentRefs } from "@/lib/engine/development";
import { surplusDrawable, type RouteCost } from "@/lib/engine/directed-logistics";
import { isEconomicallyActive } from "@/lib/engine/control";
import { clamp } from "@/lib/utils/math";
import { hasSurvivalShortfall } from "@/lib/engine/population";
import { GOOD_TIER_BY_KEY } from "@/lib/constants/goods";
import {
  BUILDING_TYPES, OUTPUT_PER_UNIT, effectiveSpaceCost, HOUSING_TYPE, POP_CENTRE_DENSITY,
  VOCATIONAL_SCHOOL_TYPE, RESEARCH_INSTITUTE_TYPE, SKILL1_PER_SCHOOL, SKILL2_PER_INSTITUTE, labourTotal,
  FAMILY_BY_GOOD, COMPLEX_TYPES, ANCHOR_CAP, ANCHOR_RATED_COVERAGE, ANCHOR_MIN_THROUGHPUT,
} from "@/lib/constants/industry";
import { GOOD_RECIPES, PRODUCTION_GOOD_ORDER } from "@/lib/constants/recipes";
import { SURVIVAL_GOODS } from "@/lib/constants/physical-economy";
import { workCostPerLevel } from "@/lib/constants/construction";
import { charterFee, foundingCommitmentCost, foundingGoodsValue, projectedManifestWant } from "@/lib/engine/founding-cost";
import {
  colonyValue, factionMissingResources, factionSaturation, unblockedDemandByResource,
  type FactionSystemState, type GoodDeficit, type ColonyValueParams,
} from "@/lib/engine/colonisation-value";
import {
  labourDemand, housingPopCap, skill1Demand, skill2Demand, skill1Cap, skill2Cap,
  familyAnchorBuff, familyThroughput, inputDemandFromProduction, labourFulfilment,
} from "@/lib/engine/industry";

/**
 * A good the necessity band ranks above every other good (water, food — `SURVIVAL_GOODS`). The ONE
 * definition of the band: `recordScoredOpportunity`'s per-system alert-bar report and the
 * `opportunities.sort` claim order both call this, so the two can never disagree about which good is
 * survival-serving.
 */
function isSurvivalGood(goodId: string): boolean {
  return SURVIVAL_GOODS.includes(goodId);
}

/** Market state for one good at one system — the build planner's per-good input. */
export interface BuildGoodState {
  goodId: string;
  stock: number;
  /** Cycles-of-supply DONOR floor (DONOR_RESERVE_COVER × demand × anchorMult) — what an ordinary
   *  donor keeps for itself, so the input-supply gate reads "surplus" exactly as the logistics
   *  matcher does. Optional for engine-test fixtures; the tick path always supplies it via
   *  toGoodMarketStates. Absent, the gate reconstructs it from `demand` without `anchorMult`, so a
   *  fixture that omits the field is governed by the same demand-denominated rule as the live path. */
  donorReserve?: number;
  /** Total local demand rate (civilian + industrial); severity weight + the self-supply gate (vs production). */
  demand: number;
  /** Civilian-only demand rate — what the fed gate reads to know whether anyone here wants this good.
   *  Optional for engine-test fixtures, which then read as having nobody to feed (i.e. fed) exactly as
   *  a missing `satisfaction` reads as fully delivered; the tick path always supplies it via
   *  toGoodMarketStates. */
  civilianDemand?: number;
  /**
   * Local production rate of this good. A self-supplier (production ≥ demand) is never a
   * structural deficit — its low standing stock is throughput, not need (mirrors the logistics
   * matcher's self-supply gate). Optional for engine-test fixtures; the tick path always
   * supplies it via toGoodMarketStates (a GoodMarketState, which carries production).
   */
  production?: number;
  /** Current building capacity. The tick path always supplies this separately from realised production. */
  capacityProduction: number;
  /**
   * Persisted consumption satisfaction from the last economy cycle (delivered ÷ demanded, ∈
   * [0,1]; missing ⇒ 1) — what `fed()` reads. `stock` stays on this type for the
   * input-supply gate; it does not feed the housing gate.
   */
  satisfaction?: number;
  /** Strike or maintenance reduced actual output; event modifiers deliberately do not set this. */
  productionSuppressed?: boolean;
  /** Reference-cycles a rationed economy assessment has persisted — a finite value in [0,2] advanced
   *  per assessment by the economy interval's catchUpFactor (so the latency is cadence-invariant). */
  squeezeCycles?: number;
  /** Reference-cycles a structural construction assessment has persisted — a finite value in [0,2]
   *  advanced per assessment by the construction interval's catchUpFactor. */
  proposalCycles?: number;
  /** A reachable logistics match was constrained by the faction's funded haul work. */
  logisticsFundingBound?: boolean;
}

/** A system's buildable state — markets + the body-derived capacity it can build into. */
export interface BuildSystemState {
  systemId: string;
  factionId: string | null;
  /** Three-state ownership: unclaimed frontier → controlled (outpost tier) → developed (build-gate). */
  control: SystemControl;
  population: number;
  /** Current building counts (production types + "housing"). */
  buildings: Record<string, number>;
  /** Per-resource deposit-slot cap (Σ body slots) — caps tier-0 extractor counts. */
  depositCounts: ResourceVector;
  /** Per-resource ground value (quality × extraction modifier) of the NEXT unworked deposit slot —
   *  required, matching `extractionEff`'s precedent (`lib/tick/world/directed-build-world.ts`): a
   *  fixture that omits it is a type error rather than a silent neutral-1.0 fallback that could mask
   *  a real deposit-grade effect on tier-0 ranking. Pass `unitResourceVector()` for the neutral
   *  reading. */
  marginalGround: ResourceVector;
  /** People land — housing's own budget. Extractors and factories never draw on this budget;
   *  factories, academies, complexes and construction centres bill no land at all. */
  peopleLand: number;
  goods: BuildGoodState[];
}

/** One build action: add `count` units of `buildingType` (a good id, or "housing") at `systemId`. */
export interface PlannedBuild {
  systemId: string;
  buildingType: string;
  count: number;
}

/**
 * Why the industry pass's own two-pass allocator dropped a production opportunity it wanted, at the
 * site named in each comment below (`planFactionBundles`). Housing refusals (`plannedHousingUnits`)
 * are a separate pass with a separate category (No housing headroom) and never produce one of these.
 * - "no-capacity" — the site's footprint/deposit slots for the good are used up, checked before
 *   ranking (`:capUnits <= 0`, first loop) and again after (capacity another opportunity at the same
 *   site already claimed, second loop). USED UP, not merely absent: the pre-ranking check records
 *   this only for a site with a gross ceiling for the good (`hasCapacityCeiling`), so a system with
 *   no deposit for a good — never a plausible builder of it — reports nothing rather than a block.
 * - "no-input-supplier" — a tier-1+ recipe input has no reachable surplus source.
 * - "no-consumer" — no reachable system still wants this good: none is reachable at all, or every
 *   reachable one's remaining shortfall was already claimed by a higher-ranked opportunity.
 * - "no-whole-level" — capacity floors to fewer than one whole production level.
 * - "no-labour" — the space/labour fit search found no level count (1..maxLevels) the site could
 *   both house and staff. This is also where a gate's (academy/complex) OWN space requirement can
 *   fail even though production alone would have fit — there is no separate "no-gate-space" reason,
 *   so that case reads as "no-labour" too.
 */
export type BuildDropReason =
  | "no-capacity"
  | "no-input-supplier"
  | "no-consumer"
  | "no-labour"
  | "no-whole-level";

/**
 * One system's best-ranked dropped production opportunity from a `planFactionBundles` run — the
 * alert bar's Build blocked category. Absent (never constructed) for a system with nothing dropped:
 * nothing was wanted this run, or everything landed.
 *
 * `droppedRoi` is the planner's own allocation-priority signal at the point of the drop, not the
 * `value ÷ work` ROI a landed `BuildProposal` carries — that figure only exists once a bundle's
 * items, and so its `work`, are fully decided, which a dropped candidate by definition never
 * reaches. Two shapes:
 * - A drop AFTER `opportunities.sort()` (capacity/consumer/whole-level/labour, once a candidate has
 *   been scored and ranked against every other site×good) carries that candidate's own `score` —
 *   the Σ(served ÷ route cost) figure the sort itself ranked by. It is a real, comparable priority
 *   signal, just not the value/work ratio the word "ROI" means elsewhere in this file.
 * - A drop BEFORE ranking — `capUnits <= 0` is the common case, firing before a `BuildOpportunity` is
 *   even constructed for that site×good, so nothing was ever scored to report. There is no honest
 *   number to put here: `droppedRoi` is `0`, the additive identity, not a claim that the missed
 *   opportunity was worthless. A fully saturated system (blocked at every good, always this way) is
 *   the case this matters for, and it is worth flagging plainly: sorting the category by `droppedRoi`
 *   puts that system last within it, which is a real tension with "fully saturated" being one of the
 *   worse things Build blocked can mean.
 */
export interface BuildDropReport {
  systemId: string;
  reason: BuildDropReason;
  droppedRoi: number;
}

/**
 * One system's best-ranked SCORED production opportunity from a `planFactionBundles` run — the alert
 * bar's Build opportunity category. It and Build blocked (`BuildDropReport` above) read different
 * systems on different cycles. `score` is
 * `BuildOpportunity.score` verbatim — see that interface's own docstring for what it is ("Ordering
 * only", not comparable between systems, a 13× unit-spread bias across goods) and is NOT normalised,
 * rescaled or improved here.
 *
 * "Best-ranked" bands survival-serving goods (`SURVIVAL_GOODS`, `lib/constants/physical-economy.ts`)
 * above every other good, then orders by `score` within a band — the same rule the read service
 * applies when it bands the category for display (`buildOpportunitySortKey`,
 * `lib/services/alerts.ts`). A single stored score cannot be re-banded after the fact, so
 * the choice of which one candidate's terms to keep is made here, not downstream: a system whose
 * highest score belongs to a non-survival good, but which also has ANY survival-serving opportunity,
 * persists the survival one. On an exact tie (same band, same score) the first one scored in this
 * run's scan order wins — the deterministic order `remainingByGood` (goods) × `working` (sites) walks.
 *
 * Absent for a system with nothing scored this run: every (site, good) pair it was a candidate for
 * failed one of `BuildOpportunity`'s own gates (no capacity, no input supplier, no reachable consumer,
 * or a non-positive score) before a `BuildOpportunity` was ever constructed for it.
 */
export interface BuildOpportunityReport {
  systemId: string;
  goodId: string;
  score: number;
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
 * Fed gate: a system grows housing only while its people are actually fed — no survival good it
 * demands is delivered below SHORTAGE_SATISFACTION. Reads the economy cycle's persisted per-good
 * satisfaction (delivered ÷ demanded, the same measure the needs display reads) against CIVILIAN
 * demand alone, so a deliberately-at-comfort exporter reads as fed and industrial-input starvation is
 * not a reason to refuse shelter. Missing satisfaction ⇒ 1; missing civilian demand ⇒ nobody to feed.
 *
 * Deliberately the survival test and NOT the whole basket's necessity-weighted fold. Medicine and
 * consumer goods are delivered almost nowhere, so every inhabited world carries an ambient basket
 * deficit that has nothing to do with feeding anyone; a fold-wide cut therefore refuses shelter over
 * a medicine shortage, and refuses it hardest on the small colony whose only route out is the
 * workforce that housing would let it hold. Unrest is not a gate either, for the same reason:
 * crowding is itself an unrest source, so refusing relief housing on a restive world would hold the
 * valve shut on exactly the world that needs it.
 *
 * A consequence worth stating outright: `foldSupplyState` bands a system Famine only through
 * the survival floor above — a world short across the whole basket, or one carrying real
 * critical-good weight, still bands somewhere on the Provision axis (never Famine) while food and water
 * arrive fine, and is deliberately still fed here. The gate answers "can these people eat?", not "is
 * this system comfortable?", so the two readings are allowed to disagree in exactly that case.
 */
export function fed(sys: BuildSystemState): boolean {
  return !hasSurvivalShortfall(
    sys.goods.map((g) => ({
      goodId: g.goodId,
      satisfaction: clamp(g.satisfaction ?? 1, 0, 1),
      demanded: Math.max(0, g.civilianDemand ?? 0),
    })),
  );
}

/**
 * Additional housing units a site can build before hitting its physical bounds: the people-land
 * budget minus the housing already standing, in housing units. Never negative. Housing draws on
 * people land ALONE — factories, academies, complexes and construction centres bill no land at all,
 * so nothing else can bound housing.
 */
export function habitableHousingHeadroom(sys: BuildSystemState): number {
  const cost = effectiveSpaceCost(HOUSING_TYPE);
  if (cost <= 0) return 0;
  const housing = sys.buildings[HOUSING_TYPE] ?? 0;
  const remainingHabitable = sys.peopleLand - housing * cost;
  return Math.max(0, remainingHabitable / cost);
}

/**
 * Housing units to build at a site this cycle — a pressure-relief valve, not a lead-ahead pacer.
 * Nothing is built until occupancy r = population ÷ popCap has risen past RELIEF_TRIGGER; past it
 * the build is sized to bring r back down to RELIEF_TARGET, bounded by the habitable headroom.
 * Returns 0 when the site is unfed, has no room for a whole level, or has nobody to relieve. A
 * popCap of 0 with stranded residents is past the trigger, so a site whose housing is gone rebuilds
 * as soon as it is fed again.
 *
 * Whole housing levels are lumpy (one level houses POP_CENTRE_DENSITY), so the want is rounded UP to
 * at least one whole level. A small site's relief want is a fraction of a level, and flooring it
 * would leave the valve permanently shut while occupancy kept climbing — a 1-level seed colony would
 * never earn a 2nd level. Rounding up also means post-build r lands at or below RELIEF_TARGET
 * exactly when the land permits it.
 */
export function plannedHousingUnits(sys: BuildSystemState): number {
  if (!fed(sys)) return 0;
  const headroom = habitableHousingHeadroom(sys);
  if (headroom < 1) return 0; // no room for even one whole level
  const popProvided = BUILDING_TYPES[HOUSING_TYPE]?.popProvided ?? POP_CENTRE_DENSITY;
  if (popProvided <= 0) return 0;
  const currentPopCap = housingPopCap(sys.buildings);
  const pop = Math.max(0, sys.population);
  if (pop <= DIRECTED_BUILD.RELIEF_TRIGGER * currentPopCap) return 0; // below the trigger: no pressure yet
  const targetPopCap = pop / DIRECTED_BUILD.RELIEF_TARGET;            // size back to the relief target
  const wantUnits = (targetPopCap - currentPopCap) / popProvided;
  if (wantUnits <= 0) return 0;
  return Math.min(Math.floor(headroom), Math.max(1, Math.ceil(wantUnits)));
}

/** A structural build target: the margined, rate-capped share of one good's uncovered demand at a system. */
export interface StructuralDeficit {
  systemId: string;
  goodId: string;
  /** The per-tick flow this assessment commits toward = the persistent residual × BUILD_RATE_CAP (> 0). */
  rateDeficit: number;
  demand: number;
}

export interface ProposalPersistenceUpdate {
  systemId: string;
  goodId: string;
  proposalCycles: number;
}

interface StructuralAssessment {
  systems: BuildSystemState[];
  deficits: StructuralDeficit[];
  persistenceUpdates: ProposalPersistenceUpdate[];
  /**
   * Per-(system, good) resolution over the pairs this assessment considered: `eligible` is every pair
   * with `capacity > 0` — the pairs where `strikeExplains` can fire at all, since a capacity-0 pair's
   * gap is always the unconditional capacity-gap term and never a candidate for suppression;
   * `suppressed` is the subset where `strikeExplains` actually fired. Calibration instrumentation
   * only, meant to be read as a rate over `eligible` (the raw count grows with the galaxy).
   */
  strikeSuppressedProposals: { suppressed: number; eligible: number };
}

/**
 * Open BUILD-kind project levels, summed by building type — the shared fold behind every "what's
 * already queued here" read: this module's own `effectiveBuildSystems` (below), the player build
 * verbs' feasibility check (`lib/services/construction-orders.ts`), and the alert bar's No housing
 * headroom read (`lib/services/alerts.ts`). `colony_establish` projects never contribute — they
 * carry no `buildingType`/`levels` in this shape.
 */
export function queuedBuildLevelsBySystem(openProjects: WorldConstructionProject[]): Map<string, Record<string, number>> {
  const queued = new Map<string, Record<string, number>>();
  for (const project of openProjects) {
    if (project.kind !== "build") continue;
    const levels = queued.get(project.systemId) ?? {};
    levels[project.buildingType] = (levels[project.buildingType] ?? 0) + project.levels;
    queued.set(project.systemId, levels);
  }
  return queued;
}

/** Same fold as `queuedBuildLevelsBySystem`, scoped to one system — for a caller that only ever
 *  wants a single system's queue rather than the whole faction's. */
export function queuedBuildLevelsAt(openProjects: WorldConstructionProject[], systemId: string): Record<string, number> {
  const levels: Record<string, number> = {};
  for (const project of openProjects) {
    if (project.kind !== "build" || project.systemId !== systemId) continue;
    levels[project.buildingType] = (levels[project.buildingType] ?? 0) + project.levels;
  }
  return levels;
}

/**
 * Fold all committed build levels into the planner's effective state. The standing realised rate is
 * preserved; committed capacity can only add its non-negative delta, never rewrite an assessment.
 * Queued consumers also expose their input draw before they land, keeping the supply chain honest.
 */
function effectiveBuildSystems(
  systems: BuildSystemState[],
  openProjects: WorldConstructionProject[],
): BuildSystemState[] {
  const queuedBySystem = queuedBuildLevelsBySystem(openProjects);
  return systems.map((system) => {
    const queued = queuedBySystem.get(system.systemId);
    if (!queued) return system;

    const buildings = { ...system.buildings };
    for (const [buildingType, levels] of Object.entries(queued)) {
      buildings[buildingType] = (buildings[buildingType] ?? 0) + levels;
    }
    const queuedOutput = new Map<string, number>();
    for (const [buildingType, levels] of Object.entries(queued)) {
      const output = (OUTPUT_PER_UNIT[buildingType] ?? 0) * levels * familyAnchorBuff(buildings, buildingType);
      if (output > 0) queuedOutput.set(buildingType, (queuedOutput.get(buildingType) ?? 0) + output);
    }

    const goods = system.goods.map((good) => {
      const queuedCapacity = queuedOutput.get(good.goodId) ?? 0;
      const capacityProduction = good.capacityProduction + queuedCapacity;
      const standingProduction = good.production ?? good.capacityProduction;
      const production = standingProduction + Math.max(0, capacityProduction - good.capacityProduction);
      return {
        ...good,
        // The queued increment counts at raw capacity, deliberately unlike `good.demand` itself
        // (the staffing- and strike-gated use figure): capacity still in the build queue has no
        // stock, no strike and no brake state to gate it by.
        demand: good.demand + inputDemandFromProduction(good.goodId, queuedOutput),
        capacityProduction,
        production,
      };
    });
    return { ...system, buildings, goods };
  });
}

/**
 * The one gap-math implementation, shared by both planners (immediate for `planFactionBuilds`,
 * persistence-gated for `planFactionProposals`). Per (system, good) it takes the larger of the
 * provisioning-margin capacity gap (`max(0, (1 + PROVISION_MARGIN)·demand − capacity)`) and the
 * squeeze-feedback gap, then nets the faction's reachable exporter spare against it before advancing
 * persistence and rate-capping the residual. Suppression is scoped to the shortfall it can actually
 * explain: it silences the feedback gap only where the system already holds capacity in that good,
 * and never suppresses the capacity gap, so a striking world can still be given the industry it has
 * none of.
 *
 * Cancellation is flow-aware: a deficit is cancelled only to the extent reachable exporters' spare
 * surplus actually covers it, netted against other consumers already drawing on that surplus, rather
 * than by the mere presence of any surplus anywhere reachable. An exporter's spare
 * is its sustainable export RATE (`production − demand`) measured on REALISED output, so capacity
 * idled by a strike never cancels someone else's gap — it is not a stock pile either, so a neighbour
 * merely holding and draining stock never cancels a gap. Per good,
 * the reachable exporters' total spare is netted across all reachable gaps at once —
 * `coveredFraction = min(1, Σ spare / Σ reachable-gap)` (first cut per §7.6) — so one exporter's spare
 * cannot fully cover two competing colonies; each reachable gap keeps its uncovered residual and a gap
 * with no reachable exporter stays fully structural. Only economically-active (developed) systems
 * contribute gaps or spare.
 */
function assessStructuralDeficits(
  systems: BuildSystemState[],
  openProjects: WorldConstructionProject[],
  routeCost: RouteCost,
  requirePersistence: boolean,
  advance: number,
): StructuralAssessment {
  const effective = effectiveBuildSystems(systems, openProjects);
  const candidatesByGood = new Map<string, Array<{ systemId: string; gross: number }>>();
  const exportersByGood = new Map<string, Array<{ systemId: string; spare: number }>>();
  const persistenceUpdates: ProposalPersistenceUpdate[] = [];
  // Strike-suppression resolution (calibration instrumentation): counted alongside the gap math below
  // so it reads the same `capacity`/`strikeExplains` values, rather than recomputing them.
  let strikeEligible = 0;
  let strikeSuppressed = 0;

  for (const system of effective) {
    if (!isEconomicallyActive(system.control)) continue;
    for (const good of system.goods) {
      const demand = Math.max(0, good.demand);
      const capacity = Math.max(0, good.capacityProduction);
      const production = Math.max(0, good.production ?? good.capacityProduction);
      // A strike explains a shortfall only where the system already holds capacity in the good: with
      // no capacity, output would be zero at any staffing level, so the gap is structural whatever
      // the unrest — and refusing to propose it is what leaves a striking world permanently unable
      // to build its way out. The capacity gap is therefore unconditional; `capacity = 0` is its
      // ordinary case, not an exception.
      const strikeExplains = good.productionSuppressed === true && capacity > 0;
      if (capacity > 0) {
        strikeEligible++;
        if (strikeExplains) strikeSuppressed++;
      }
      const capacityGap = Math.max(0, (1 + DIRECTED_BUILD.PROVISION_MARGIN) * demand - capacity);
      const feedbackGap = !strikeExplains && !good.logisticsFundingBound && (good.squeezeCycles ?? 0) >= DIRECTED_BUILD.PERSISTENCE_CYCLES
        ? demand * (1 - clamp(good.satisfaction ?? 1, 0, 1))
        : 0;
      const gross = Math.max(capacityGap, feedbackGap);
      if (gross > 0) {
        const candidates = candidatesByGood.get(good.goodId) ?? [];
        candidates.push({ systemId: system.systemId, gross });
        candidatesByGood.set(good.goodId, candidates);
      }

      // Spare is what a system actually produces above its own needs. Capacity standing idle behind a
      // strike is not export anyone can plan against — counting it overstates the galaxy's spare and
      // cancels real gaps against supply that never ships.
      const spare = Math.max(0, production - demand);
      if (spare > 0) {
        const exporters = exportersByGood.get(good.goodId) ?? [];
        exporters.push({ systemId: system.systemId, spare });
        exportersByGood.set(good.goodId, exporters);
      }
    }
  }

  const residualByKey = new Map<string, number>();
  for (const [goodId, candidates] of candidatesByGood) {
    const exporters = exportersByGood.get(goodId) ?? [];
    // One reachability scan over (candidate × exporter): each candidate is reachable if any exporter
    // reaches it, and every exporter that reaches at least one candidate is recorded here — so its spare
    // can be summed below without re-running routeCost (an exporter reaching a candidate makes that
    // candidate reachable, so the exporter is always among a reachable gap's suppliers).
    const reachableExporterIds = new Set<string>();
    const reachable = candidates.map((candidate) => {
      let hasExporter = false;
      for (const exporter of exporters) {
        if (routeCost(exporter.systemId, candidate.systemId) !== null) {
          hasExporter = true;
          reachableExporterIds.add(exporter.systemId);
        }
      }
      return { candidate, hasExporter };
    });
    const reachableDemand = reachable
      .filter((entry) => entry.hasExporter)
      .reduce((sum, entry) => sum + entry.candidate.gross, 0);
    const reachableSpare = exporters
      .filter((exporter) => reachableExporterIds.has(exporter.systemId))
      .reduce((sum, exporter) => sum + exporter.spare, 0);
    const coveredFraction = reachableDemand > 0 ? Math.min(1, reachableSpare / reachableDemand) : 0;
    for (const entry of reachable) {
      const residual = entry.hasExporter ? entry.candidate.gross * (1 - coveredFraction) : entry.candidate.gross;
      residualByKey.set(`${entry.candidate.systemId}:${goodId}`, Math.max(0, residual));
    }
  }

  const deficits: StructuralDeficit[] = [];
  for (const system of effective) {
    if (!isEconomicallyActive(system.control)) continue;
    for (const good of system.goods) {
      const residual = residualByKey.get(`${system.systemId}:${good.goodId}`) ?? 0;
      // Advance by the reference-time this assessment represents (catchUpFactor of the caller's
      // interval), not a flat +1, so the "two reference cycles of persistence" latency is the same
      // wall-clock span at any construction cadence. The counter is fractional, finite, clamped [0,2].
      const nextCycles = residual > 0
        ? Math.min(DIRECTED_BUILD.PERSISTENCE_CYCLES, Math.max(0, good.proposalCycles ?? 0) + advance)
        : 0;
      persistenceUpdates.push({ systemId: system.systemId, goodId: good.goodId, proposalCycles: nextCycles });
      if (residual <= 0 || (requirePersistence && nextCycles < DIRECTED_BUILD.PERSISTENCE_CYCLES)) continue;
      deficits.push({
        systemId: system.systemId,
        goodId: good.goodId,
        rateDeficit: residual * DIRECTED_BUILD.BUILD_RATE_CAP,
        demand: good.demand,
      });
    }
  }

  return {
    systems: effective, deficits, persistenceUpdates,
    strikeSuppressedProposals: { suppressed: strikeSuppressed, eligible: strikeEligible },
  };
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
 * Tier-0: remaining deposit slots for the good's resource — the only physical land cap
 * industry building carries. Tier-1+ bills no land at all (labour, demand and decay bound
 * it instead), so it reads unbounded here. Never negative.
 */
export function buildableUnits(sys: BuildSystemState, goodId: string): number {
  const tier = GOOD_TIER_BY_KEY[goodId];
  if (tier === undefined) return 0;
  if (tier === 0) {
    const resource = BUILDING_TYPES[goodId]?.resource;
    if (!resource) return 0;
    const cap = sys.depositCounts[resource];
    const remaining = cap - extractorsOnResource(sys.buildings, resource);
    return Math.max(0, remaining);
  }
  return effectiveSpaceCost(goodId) > 0 ? Infinity : 0;
}

/**
 * Could this system host a unit of `goodId` AT ALL — its gross ceiling, ignoring everything already
 * built? Tier-0 needs at least one deposit slot for the good's resource; tier-1+ needs only a
 * positive footprint (labour/demand/decay gate it elsewhere, never land). This is what separates the
 * two states `buildableUnits` returns 0 for alike: a site whose capacity for the good is USED UP (a
 * real, reportable obstacle) and a site that never had any (a good it was never a plausible builder
 * of — most goods at most systems).
 */
function hasCapacityCeiling(sys: BuildSystemState, goodId: string): boolean {
  const tier = GOOD_TIER_BY_KEY[goodId];
  if (tier === undefined) return false;
  if (tier === 0) {
    const resource = BUILDING_TYPES[goodId]?.resource;
    if (!resource) return false;
    return sys.depositCounts[resource] > 0;
  }
  return effectiveSpaceCost(goodId) > 0;
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
 * One recipe input is MISSING at a site unless it is either produced locally (a local building of
 * `input`) or held as a surplus at a system REACHABLE FROM THE SITE. The factory's inputs arrive
 * via logistics, which is route-cost bounded, so a surplus that merely exists somewhere in the
 * faction is not enough — it must be deliverable to this site (routeCost(source, site) non-null).
 * Shared by `inputsAvailable` (the tier-1+ proposal gate) and the derived-demand spill, so the two
 * can never disagree on the same input at the same site.
 */
function inputMissingAt(
  input: string,
  site: BuildSystemState,
  surplusSystemsByGood: Map<string, string[]>,
  routeCost: RouteCost,
): boolean {
  if ((site.buildings[input] ?? 0) > 0) return false;
  const sources = surplusSystemsByGood.get(input);
  return !(sources !== undefined && sources.some((su) => routeCost(su, site.systemId) !== null));
}

/**
 * A tier-1+ site is build-eligible this cycle only when every recipe input is either produced
 * locally or held as a surplus at a system REACHABLE FROM THE SITE (`inputMissingAt`, negated).
 */
function inputsAvailable(
  goodId: string,
  site: BuildSystemState,
  surplusSystemsByGood: Map<string, string[]>,
  routeCost: RouteCost,
): boolean {
  // Callers gate on !isTier0, and every tier-1+ good carries a GOOD_RECIPES entry — a missing
  // recipe here is a catalog defect and should throw, not read as "no input constraint".
  const recipe = GOOD_RECIPES[goodId];
  return Object.keys(recipe).every((input) => !inputMissingAt(input, site, surplusSystemsByGood, routeCost));
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
 * ceiling to cover the post-build skill demand. Tier-0 (no skill draw) → none — academies are
 * never built to unblock a good that doesn't draw on either skill pool.
 */
function academyLift(
  site: BuildSystemState,
  goodId: string,
  prodUnits: number,
): { schools: number; institutes: number } {
  const v = BUILDING_TYPES[goodId]?.labour;
  const tier = GOOD_TIER_BY_KEY[goodId] ?? 0;
  if (!v || tier === 0) return { schools: 0, institutes: 0 };

  const need1 = skill1Demand(site.buildings) + prodUnits * v.skill1 - skill1Cap(site.buildings);
  const need2 = skill2Demand(site.buildings) + prodUnits * v.skill2 - skill2Cap(site.buildings);
  // Fractional lift — the consumer (fitFor) rounds to whole buildings and prices space/labour
  // itself off the ceiled counts, so no priced fields are returned here.
  return {
    schools: need1 > 0 ? need1 / SKILL1_PER_SCHOOL : 0,
    institutes: need2 > 0 ? need2 / SKILL2_PER_INSTITUTE : 0,
  };
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
): { complexType?: string; count: number } {
  const zero = { count: 0 };
  const family = FAMILY_BY_GOOD[goodId];
  if (!family) return zero;
  let existing = 0;
  for (const t of COMPLEX_TYPES) existing += site.buildings[t] ?? 0;
  if (existing >= ANCHOR_CAP) return zero;
  const projected = familyThroughput(site.buildings, family) + prodUnits * (OUTPUT_PER_UNIT[goodId] ?? 0);
  if (projected < ANCHOR_MIN_THROUGHPUT) return zero;
  const count = Math.min(ANCHOR_CAP - existing, projected / ANCHOR_RATED_COVERAGE);
  if (count <= 0) return zero;
  // Fractional count — fitFor ceils to whole complexes and prices space/labour itself.
  return { complexType: family.complexType, count };
}

/** One whole-level order within a proposal bundle: `levels` of `buildingType`. */
export interface ProposalItem {
  buildingType: string;
  levels: number;
}

/**
 * A funding proposal — the unit that carries an ROI (docs/active/gameplay/colonisation.md).
 * A BuildProposal BUNDLES a production level-set with the academies/complex that GATE it, in `items`
 * held gate-first (complex → schools → institutes → production); a housing proposal is a single
 * housing item. ROI = `value` (served demand-rate the production covers) ÷ `work` (the WHOLE bundle's
 * level work), so an enabler — an academy/complex with no served demand of its own — raises the
 * denominator without touching the numerator: the bundle funds gate-first at the production's ROI and
 * the school never ranks below the factory it staffs. A colony establish is instead the single-item
 * `ColonyProposal` below.
 */
export interface BuildProposal {
  kind: "build";
  factionId: string;
  systemId: string;
  /** Housing relieves crowding (substrate, no served-demand ROI); industry ranks by ROI. */
  role: "housing" | "industry";
  /** Whole-level orders in gate-first funding order. */
  items: ProposalItem[];
  /** Served demand-rate this bundle's production covers — the ROI numerator (0 for housing). */
  value: number;
  /** Σ over items of `levels × workCostPerLevel` — the ROI denominator. */
  work: number;
  /** The good this bundle's production serves — set on every industry bundle (`opp.goodId`), absent
   *  on housing. The funding order's survival test (`orderProposals`) reads this, never `items[0]`
   *  (whose gate-first order puts production last). */
  producedGood?: string;
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
  /** The good this bundle's production serves — set on every industry bundle, absent on housing. */
  producedGood?: string;
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
  structural: StructuralDeficit[],
): { bundles: PlannedBundle[]; blocked: BuildDropReport[]; topOpportunities: BuildOpportunityReport[] } {
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

  // Per-system best-ranked dropped opportunity this run (BuildDropReport docstring above has the
  // full reasoning). A ranked drop always wins over an unranked one for the same system — a scored
  // candidate is strictly more informative than one that was never scored — and within one class the
  // FIRST one recorded wins: for ranked drops that is the highest-scored, because `opportunities`
  // (below) is iterated in descending-score order; for unranked drops there is no ranking to prefer
  // among, so it is whichever the deterministic scan order reaches first.
  const rankedBlockBySystem = new Map<string, BuildDropReport>();
  const unrankedBlockBySystem = new Map<string, BuildDropReport>();
  const recordUnrankedDrop = (systemId: string, reason: BuildDropReason): void => {
    if (unrankedBlockBySystem.has(systemId)) return;
    unrankedBlockBySystem.set(systemId, { systemId, reason, droppedRoi: 0 });
  };
  const recordRankedDrop = (systemId: string, reason: BuildDropReason, droppedRoi: number): void => {
    if (rankedBlockBySystem.has(systemId)) return;
    rankedBlockBySystem.set(systemId, { systemId, reason, droppedRoi });
  };

  // Per-system best-ranked SCORED opportunity this run (BuildOpportunityReport docstring above has
  // the full reasoning) — survival-serving goods band above every other good, highest score wins
  // within a band, first-scored wins an exact tie. Recorded as each candidate is scored below, not
  // reduced afterward, so it needs no second pass over `opportunities`.
  const bestOpportunityBySystem = new Map<string, BuildOpportunityReport & { survival: boolean }>();
  const recordScoredOpportunity = (systemId: string, goodId: string, score: number): void => {
    const survival = isSurvivalGood(goodId);
    const current = bestOpportunityBySystem.get(systemId);
    if (current) {
      // A survival-serving current always outranks a non-survival candidate, whatever the scores.
      if (current.survival && !survival) return;
      // Same band: keep the higher (or equal — first-scored wins the tie) score.
      if (current.survival === survival && current.score >= score) return;
    }
    bestOpportunityBySystem.set(systemId, { systemId, goodId, score, survival });
  };

  // ── Pass 1: housing relief (housing follows crowding). ──
  // Wherever a fed system's occupancy has outrun its housing, build the levels that bring it
  // back to the relief target, bounded by the habitable cap. Housing draws habitable (people)
  // land, industry draws general space — separate budgets — but housing still runs first:
  // habitable land is housing's by right, sized before this cycle's industry pass ever looks at
  // what general space is left.
  for (const site of working.values()) {
    // Whole levels only, and the want already is one: plannedHousingUnits rounds up to a whole
    // level and land-clamps with a floor, so it never returns a fraction to re-round here.
    const levels = plannedHousingUnits(site);
    if (levels < 1) continue;
    site.buildings[HOUSING_TYPE] = (site.buildings[HOUSING_TYPE] ?? 0) + levels;
    bundles.push({
      systemId: site.systemId,
      role: "housing",
      items: [{ buildingType: HOUSING_TYPE, levels }],
      value: 0, // relief substrate — no served-demand ROI; the funding stage leads housing anyway
      work: levels * workCostPerLevel(HOUSING_TYPE),
    });
  }

  // ── Pass 2: labour-gated industry (industry follows the resident workforce). ──


  // Remaining structural shortfall per (good → systemId → shortfall).
  const remainingByGood = new Map<string, Map<string, number>>();
  for (const d of structural) {
    const m = remainingByGood.get(d.goodId) ?? new Map<string, number>();
    m.set(d.systemId, (m.get(d.systemId) ?? 0) + d.rateDeficit);
    remainingByGood.set(d.goodId, m);
  }

  // Surplus-holding systems per good — the input-supply side of the tier-1+ gate. A factory's
  // recipe inputs arrive via route-cost-bounded logistics, so the gate checks for a surplus
  // reachable FROM each candidate site (see inputsAvailable), not merely one somewhere in the
  // faction. Built from the untouched `systems` market state, ahead of the speculative-floor loop
  // below (which only ever writes `remainingByGood`, never a system's goods) — so no floor write
  // can feed this map.
  const surplusSystemsByGood = new Map<string, string[]>();
  for (const s of systems) {
    for (const g of s.goods) {
      const donorReserve = g.donorReserve
        ?? DIRECTED_LOGISTICS.DONOR_RESERVE_COVER * Math.max(0, g.demand);
      if (surplusDrawable(g.stock, donorReserve, g.demand, g.production ?? 0, g.productionSuppressed) > 0) {
        const list = surplusSystemsByGood.get(g.goodId) ?? [];
        list.push(s.systemId);
        surplusSystemsByGood.set(g.goodId, list);
      }
    }
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

  if (remainingByGood.size === 0) return { bundles, blocked: [], topOpportunities: [] };

  // Derived demand (the spill): unmet tier-1+ shortfall demands its own missing recipe
  // inputs too. Walking `PRODUCTION_GOOD_ORDER` in REVERSE visits every consumer before its own
  // inputs, so one pass cascades all the way down — a good's missing inputs pick up whatever was
  // just spilled onto it before their own turn to spill arrives. "Missing" is exactly
  // `inputMissingAt` (the same predicate the input-supply gate reads), read against the CURRENT
  // `remainingByGood` entry (structural + floor + any derived demand already spilled from a
  // higher good this same pass — that IS the cascade). Tier-0 goods carry no `GOOD_RECIPES` entry
  // and terminate it. Never persisted: recomputed from live shortfalls and live missingness every
  // run, and vanishes the run its parent shortfall closes or its input stops being missing.
  for (const goodId of [...PRODUCTION_GOOD_ORDER].reverse()) {
    const recipe = GOOD_RECIPES[goodId];
    if (!recipe) continue; // tier-0: no recipe, nothing to spill onto
    const deficitMap = remainingByGood.get(goodId);
    if (!deficitMap) continue;
    for (const [systemId, shortfall] of deficitMap) {
      if (shortfall <= 0) continue;
      const site = working.get(systemId);
      if (!site) continue;
      for (const [input, ratio] of Object.entries(recipe)) {
        if (!inputMissingAt(input, site, surplusSystemsByGood, routeCost)) continue;
        const m = remainingByGood.get(input) ?? new Map<string, number>();
        m.set(systemId, (m.get(systemId) ?? 0) + shortfall * ratio);
        remainingByGood.set(input, m);
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
      if (capUnits <= 0) {
        // The literal "no capacity" case, and the one that fires BEFORE a BuildOpportunity is ever
        // constructed for this site×good — see BuildDropReport's docstring for what droppedRoi means
        // here (nothing: no rank exists yet).
        //
        // Recorded only where the site HAS a ceiling for this good to have exhausted. Every site is
        // scanned against every good in deficit — food and water always among them — so without this
        // gate a system with no arable deposit at all would report a blocked food build, and nearly
        // every economically-active system in the faction would carry a block every run for goods it
        // could never have built. That is the opposite of what the report means, and it would break
        // the absence convention the write path relies on: a visited system with no entry landed
        // everything or wanted nothing.
        if (hasCapacityCeiling(site, goodId)) recordUnrankedDrop(site.systemId, "no-capacity");
        continue;
      }
      if (!isTier0 && !inputsAvailable(goodId, site, surplusSystemsByGood, routeCost)) {
        recordUnrankedDrop(site.systemId, "no-input-supplier");
        continue;
      }

      const reachable = deficitSystemIds
        .map((sysId) => ({ sysId, cost: routeCost(site.systemId, sysId) }))
        .filter((r): r is { sysId: string; cost: number } => r.cost !== null && r.cost > 0)
        .sort((a, b) => a.cost - b.cost);
      if (reachable.length === 0) {
        recordUnrankedDrop(site.systemId, "no-consumer");
        continue;
      }

      // Score family goods at their buffed per-unit so a seeded-complex site already ranks
      // higher (the snowball): buffed output means more served demand per unit of capacity.
      const perUnit = baseUnit * familyAnchorBuff(site.buildings, goodId);

      // Tier-0's SCORE additionally scales by the NEXT unworked deposit's ground value
      // (`marginalGround`, adapter-folded from `marginalSlot`): a rich-ground site ranks above an
      // equal-shortfall site whose next slot is poor. `scorePerUnit` is deliberately a SEPARATE
      // quantity from `perUnit` above: `perUnit` is what gets stored on the opportunity and read by
      // the take/capacity loop and the ranked-consumption loop further down this function — both
      // stay on the unscaled figure, so realised production and the served/deficit-decrement
      // arithmetic are unaffected. Only `scorePerUnit` (this block) and everything derived from it
      // (`buildWorkPerUnit`, the tier-0 demand-proximity fold just below) carries the multiplier.
      const groundResource = isTier0 ? BUILDING_TYPES[goodId]?.resource : undefined;
      // Clamped at 1: poor ground DEMOTES a tier-0 opportunity, rich ground never promotes it.
      // The score is one shared scale across both tiers, and raw ground values run 0.4-2.5
      // (QUALITY_BANDS) with colonies working best-first — an unclamped multiplier inflates the
      // whole tier-0 band ~1.4-2.5x against tier-1+ at exactly the sites being developed, and
      // extraction then out-claims the factories the shared labour pool was about to staff.
      const groundMult = groundResource !== undefined ? Math.min(1, site.marginalGround[groundResource]) : 1;
      const scorePerUnit = perUnit * groundMult;

      // ONE shared score unit for both tiers — marginal-construction-work-per-delivered-unit,
      // exactly the tier-1+ quantity, now also underlying tier-0: this good's own build cost
      // amortised over its (buffed, ground-scaled) per-level output (`scorePerUnit`, which already
      // folds in whatever yield/efficiency scaling the existing tier-0 capacity maths defines output
      // with), plus — only when the site carries NO specialisation complex of any family yet
      // (COMPLEX_TYPES, ANCHOR_CAP 1 site-wide, the same gate complexLift itself uses) — the
      // complex's build cost amortised over the full demand this opportunity would serve
      // (`totalServed`). Tier-0 goods carry no family (`FAMILY_BY_GOOD`), so the surcharge is always
      // 0 for them — the formula is shared regardless, so there is exactly one scale to compare, not
      // two coincidentally similar-looking ones.
      const buildWorkPerUnit = workCostPerLevel(goodId) / scorePerUnit;

      // Demand numerator: proximity-weighted served demand. Tier-0 keeps its real physics — the
      // site's finite deposit-slot output capacity, allocated to reachable deficits nearest-first
      // (the capacity cap this tier actually has and tier-1+ does not, `capUnits` there being
      // Infinity — buildableUnits has no land ceiling left to bind it). Tier-1+ is uncapped:
      // nothing bounds how much of the reachable shortfall a site COULD serve, so every reachable
      // deficit counts in full (`take = short`, no capacity to exhaust). This fold is SCORE-ONLY (it
      // feeds `demandProximity`/`totalServed` alone, never stored on the opportunity), so it is the
      // one tier-0 place that legitimately uses `scorePerUnit` instead of `perUnit`.
      let demandProximity = 0;
      let totalServed = 0;
      if (isTier0) {
        let capOutput = capUnits * scorePerUnit;
        for (const r of reachable) {
          if (capOutput <= 0) break;
          const short = deficitMap.get(r.sysId) ?? 0;
          if (short <= 0) continue;
          const take = Math.min(capOutput, short);
          demandProximity += take / r.cost;
          totalServed += take;
          capOutput -= take;
        }
      } else {
        for (const r of reachable) {
          const short = deficitMap.get(r.sysId) ?? 0;
          if (short <= 0) continue;
          demandProximity += short / r.cost;
          totalServed += short;
        }
      }

      const family = FAMILY_BY_GOOD[goodId];
      let hasComplex = false;
      if (family) {
        for (const t of COMPLEX_TYPES) {
          if ((site.buildings[t] ?? 0) > 0) { hasComplex = true; break; }
        }
      }
      const complexSurchargePerUnit = family && !hasComplex && totalServed > 0
        ? workCostPerLevel(family.complexType) / totalServed
        : 0;
      const marginalWorkPerUnit = buildWorkPerUnit + complexSurchargePerUnit;

      // Shared staffing factor: projected labour fulfilment of the marginal unit (one more level
      // of `goodId`, on top of the site's CURRENT buildings and population — the same headcount
      // projection `estStaffing` reads, lib/engine/build-options.ts) so an unstaffable site does
      // not outrank a staffed hub. Headcount only (`labourFulfil`), not the skill-1/skill-2 ceiling
      // gates: those ceilings are raised by co-built academies as part of the SAME bundle
      // (`academyLift`/`fitFor`, below, sized off exactly this production count), so a fresh site
      // with no academy yet would otherwise always score a skill-drawing good at 0 regardless of
      // population — the ceiling isn't a property of the site, it's a property of the bundle this
      // opportunity is about to build. Multiplicative: score scales directly with how much of the
      // marginal unit's headcount draw the site's existing population actually covers. Never
      // negative; for any site with population > 0 it is never exactly zero either, since
      // `labourFulfilment` is a ratio of two positives — only a genuinely pop-0 site drives it to
      // 0, which is correct: nothing there could staff the build at all. The after-pick labour gate
      // (`fitFor`, below) is unchanged — this only affects RANKING.
      const nextBuildings = { ...site.buildings, [goodId]: (site.buildings[goodId] ?? 0) + 1 };
      const staffingFactor = labourFulfilment(site.population, labourDemand(nextBuildings));

      // The score itself: demand served per unit of marginal construction work, scaled by
      // staffing — the SAME unit for both tiers now, so one sort and one per-system
      // best-opportunity comparison rank a single quantity instead of two different-scale ones.
      const score = totalServed > 0 ? (demandProximity / marginalWorkPerUnit) * staffingFactor : 0;
      if (score <= 0) {
        // Both tiers now share the same staffing factor, so both legitimately reach 0 the same
        // way: a population-0 site (the staffing fold above), which correctly has nothing to rank.
        // `totalServed` reaching 0 independently of staffing should not happen given today's
        // invariants — every entry `deficitSystemIds` contains carries a strictly positive
        // shortfall by construction (see remainingByGood above), `perUnit` is bounded below by
        // `baseUnit > 0` via familyAnchorBuff (never < 1), and `reachable` is non-empty here.
        // Guarded rather than assumed either way, and recorded as "no-consumer" (the closest fit of
        // the five) rather than forcing a new reason for what should be a rare, uninteresting state.
        recordUnrankedDrop(site.systemId, "no-consumer");
        continue;
      }

      opportunities.push({ systemId: site.systemId, goodId, perUnit, reachable, score });
      // Build opportunity's own signal (distinct from the blocked-drop reports above): every scored
      // candidate is a real opportunity whether or not it goes on to land, so this records BEFORE the
      // ranked-consumption loop below decides what actually builds.
      recordScoredOpportunity(site.systemId, goodId, score);
    }
  }

  // Band-then-score claim order: a survival-serving opportunity (`isSurvivalGood`) always claims the
  // shared per-site capacity/labour ahead of every non-survival one, whatever the scores; within a
  // band, descending score (a stable sort preserves the first-scored tie already implicit in push
  // order, mirroring `recordScoredOpportunity`'s rule above).
  opportunities.sort((a, b) => {
    const aSurvival = isSurvivalGood(a.goodId);
    const bSurvival = isSurvivalGood(b.goodId);
    if (aSurvival !== bSurvival) return aSurvival ? -1 : 1;
    return b.score - a.score;
  });

  for (const opp of opportunities) {
    const site = working.get(opp.systemId);
    if (!site) continue;

    const capUnits = buildableUnits(site, opp.goodId);
    if (capUnits <= 0) {
      // Post-ranking: a higher-scored opportunity at this same site (a different good) already
      // claimed the capacity this one needed. `opp.score` is a real, ranked figure here — see
      // BuildDropReport's docstring.
      recordRankedDrop(opp.systemId, "no-capacity", opp.score);
      continue;
    }

    const deficitMap = remainingByGood.get(opp.goodId);
    if (!deficitMap) {
      // `opp.goodId` is one of `remainingByGood`'s own keys (opportunities are only ever built from
      // its entries, and nothing in this function deletes a key from it), so this should not be
      // reachable given today's invariants. Guarded rather than assumed; recorded as "no-consumer"
      // (no demand map for this good is, at least, in that family) rather than forcing a new reason.
      recordRankedDrop(opp.systemId, "no-consumer", opp.score);
      continue;
    }

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
    if (servedOutput <= 0) {
      // Every reachable system's remaining shortfall was already claimed by a higher-scored
      // opportunity processed earlier this pass.
      recordRankedDrop(opp.systemId, "no-consumer", opp.score);
      continue;
    }

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
    // Full per-unit head count (unskilled + skill1 + skill2) — population staffs the WHOLE labour
    // draw of a production unit, not just its unskilled slice.
    const prodLabourPerUnit = labourTotal(BUILDING_TYPES[opp.goodId]?.labour ?? { unskilled: 0, skill1: 0, skill2: 0 });

    // Whole-level convergence: the desired production floored to whole levels (you commission whole
    // levels), then the academies and complex that GATE it rounded UP — a gate must fully exist to
    // license/anchor the production it serves (a fractional school licenses nobody). The largest
    // whole-level count the site can STAFF is found by binary search: the fit is monotone (more
    // levels ⇒ more labour), so a landed level is never unstaffable. Recomputing the lift per
    // candidate level mirrors the fractional planner's convergence on whole levels.
    // Round the served RATE deficit UP to whole levels: capacity is lumpy, so meeting a flow smaller
    // than one level's output still commits one level (the design's accepted overshoot — the excess
    // fills the passive buffer). Flooring here would build NOTHING whenever a system's per-tick demand
    // is below a single building's output, stranding every small consumer. Bounded only by demand — no
    // land caps a factory build; `capUnits` is Infinity for every tier-1+ good.
    const maxLevels = Math.min(Math.floor(capUnits), Math.ceil(servedOutput / opp.perUnit));
    if (maxLevels < 1) {
      // Capacity is real (capUnits > 0, checked above) but too small for even one whole level.
      recordRankedDrop(opp.systemId, "no-whole-level", opp.score);
      continue;
    }

    const fitFor = (levels: number) => {
      const a = academyLift(site, opp.goodId, levels);
      const c = complexLift(site, opp.goodId, levels);
      const schools = a.schools > 0 ? Math.ceil(a.schools) : 0;
      const institutes = a.institutes > 0 ? Math.ceil(a.institutes) : 0;
      const complexType = c.complexType;
      const complexLevels = c.count > 0 ? Math.ceil(c.count) : 0;
      const labourNeeded =
        levels * prodLabourPerUnit +
        schools * unskilledPerUnit(VOCATIONAL_SCHOOL_TYPE) +
        institutes * unskilledPerUnit(RESEARCH_INSTITUTE_TYPE) +
        (complexType ? complexLevels * unskilledPerUnit(complexType) : 0);
      // Total labour demand after this build stays STRICTLY within one production-unit of the
      // population, so the lead unit is only ever fractionally idle (< 1 whole unit ⇒ decay-safe; the
      // strict `<` excludes the exact-boundary case that would leave a whole unit idle, and refuses to
      // build at all on a pop-0 world). Gating TOTAL demand — not a max(0)-floored spare — bounds the
      // lead across opportunities so it can't stack into multi-unit under-staffing. No land term: a
      // factory, academy or complex bills no land at all.
      const fits = labourDemand(site.buildings) + labourNeeded < site.population + prodLabourPerUnit;
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
    if (prodLevels < 1) {
      // The space/labour fit search found no level count in [1, maxLevels] the site could both
      // house (production + any gate it would need) and staff.
      recordRankedDrop(opp.systemId, "no-labour", opp.score);
      continue;
    }

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

    bundles.push({ systemId: site.systemId, role: "industry", items, value, work, producedGood: opp.goodId });
  }

  // A ranked drop always outranks an unranked one for the same system (see the docstring on the two
  // maps above); a system with neither simply has nothing to report.
  const blocked: BuildDropReport[] = [];
  const blockedSystemIds = new Set([...rankedBlockBySystem.keys(), ...unrankedBlockBySystem.keys()]);
  for (const systemId of blockedSystemIds) {
    const report = rankedBlockBySystem.get(systemId) ?? unrankedBlockBySystem.get(systemId);
    if (report) blocked.push(report);
  }

  const topOpportunities: BuildOpportunityReport[] = [...bestOpportunityBySystem.values()].map(
    ({ systemId, goodId, score }) => ({ systemId, goodId, score }),
  );

  return { bundles, blocked, topOpportunities };
}

/**
 * Flat build view of the planner — the same decisions `planFactionBundles` makes, ungrouped, in
 * emission order (housing pass, then industry opportunities by descending score). Shares the one gap
 * assessment with `planFactionProposals` (same provisioning margin and rate cap) but takes it
 * immediately — no two-cycle persistence gate and no in-flight projects to fold. Kept as the stable
 * unit-test surface for the planner's *what-gets-built* logic, independent of funding order.
 */
export function planFactionBuilds(
  systems: BuildSystemState[],
  routeCost: RouteCost,
  refs: DevelopmentRefs,
  advance = 1,
): PlannedBuild[] {
  const assessment = assessStructuralDeficits(systems, [], routeCost, false, advance);
  // The blocked-drop report is Build blocked's alert-bar signal, scoped to the tick path
  // (`planFactionProposals` below) — this engine-test surface deliberately discards it.
  const { bundles } = planFactionBundles(assessment.systems, routeCost, refs, assessment.deficits);
  return bundles.flatMap((bundle) =>
    bundle.items.map((item) => ({ systemId: bundle.systemId, buildingType: item.buildingType, count: item.levels })),
  );
}

/** Persistence write emitted alongside the pure faction build decisions. */
export interface FactionBuildPlan {
  proposals: BuildProposal[];
  persistenceUpdates: ProposalPersistenceUpdate[];
  /** Carried through from `assessStructuralDeficits` unchanged — see `StructuralAssessment`'s
   *  docstring. Calibration instrumentation only. */
  strikeSuppressedProposals: { suppressed: number; eligible: number };
  /** This run's best-ranked dropped production opportunity per system that had one — see
   *  `BuildDropReport`. Persisted world state, unlike `strikeSuppressedProposals` above. */
  blockedBuilds: BuildDropReport[];
  /** This run's best-ranked SCORED production opportunity per system that had one — see
   *  `BuildOpportunityReport`. Persisted world state, alongside `blockedBuilds` above. */
  buildOpportunities: BuildOpportunityReport[];
}

/**
 * Build proposals for a faction's next construction assessment. Open work is counted before any
 * policy decision: it consumes footprint/labour, contributes capacity and input demand, and cannot
 * be re-proposed. Housing answers current crowding; only industry awaits a persistent residual.
 *
 * `advance` is the reference-time one assessment contributes to the persistence counter — the
 * processor passes `catchUpFactor(interval)` so the two-reference-cycle latency is cadence-invariant;
 * it defaults to 1 for direct callers.
 */
export function planFactionProposals(
  systems: BuildSystemState[],
  routeCost: RouteCost,
  openProjects: WorldConstructionProject[],
  refs: DevelopmentRefs,
  advance = 1,
): FactionBuildPlan {
  const assessment = assessStructuralDeficits(systems, openProjects, routeCost, true, advance);
  const factionBySystem = new Map(systems.map((system) => [system.systemId, system.factionId]));
  const proposals: BuildProposal[] = [];
  const { bundles, blocked, topOpportunities } = planFactionBundles(assessment.systems, routeCost, refs, assessment.deficits);
  for (const bundle of bundles) {
    const factionId = factionBySystem.get(bundle.systemId);
    if (factionId === null || factionId === undefined) continue;
    proposals.push({
      kind: "build",
      factionId,
      systemId: bundle.systemId,
      role: bundle.role,
      items: bundle.items,
      value: bundle.value,
      work: bundle.work,
      producedGood: bundle.producedGood,
    });
  }
  return {
    proposals, persistenceUpdates: assessment.persistenceUpdates,
    strikeSuppressedProposals: assessment.strikeSuppressedProposals,
    blockedBuilds: blocked,
    buildOpportunities: topOpportunities,
  };
}
/** A controlled system a faction could settle: its substrate + the developed seed source (from hop data). */
export interface ColonyEstablishCandidate {
  systemId: string;
  peopleLand: number;
  depositCounts: ResourceVector;
  /** Nearest developed same-faction system — the conserved seed source (non-null; the provider drops sourceless). */
  sourceSystemId: string;
}

/** Tunable colony inputs: the valuation coefficients plus the establish cost, seed base, and habitable floor. */
export interface ColonyEstablishParams extends ColonyValueParams {
  /** Base settle work before the bundled seed-housing's build cost (COLONISATION.COLONY_ESTABLISH_WORK). */
  establishWork: number;
  /** Starter colony population, land-capped at proposal (EXPANSION.COLONY_SEED_POP). */
  seedPop: number;
  /** Minimum habitable space to consider a controlled system a colony candidate — one whole housing
   *  level of people land (`effectiveSpaceCost(HOUSING_TYPE)`). */
  habitableFloor: number;
  /** Weight on the seed-pop opportunity cost netted off colony value (COLONISATION.SEED_POP_COST_WEIGHT). */
  popCostWeight: number;
  /** Settler supply (drawable pop/cycle) a faction must have per hungry colony to open another — the anti-sprawl gate (COLONISATION.MIN_SETTLER_SUPPLY). */
  minSettlerSupply: number;
  /** Fraction of a source's staffed workers drawable as settlers (mirrors MIGRATION_PARAMS.employedLeakFraction). */
  employedLeakFraction: number;
  /** Multiplier on the faction's maintenance bill setting the charter fee (COLONISATION.CHARTER_FEE_SPEND_MULT). */
  charterMult: number;
  /** Hard floor under the charter fee (COLONISATION.CHARTER_FEE_MIN). */
  charterMin: number;
  /** Multiplier on a candidate's projected material bill in the affordability gate (COLONISATION.FOUNDING_GATE_HEADROOM). */
  gateHeadroom: number;
  /** Cycles of the seed's raw consumption the projected manifest covers (COLONISATION.FOUNDING_STOCK_COVER). */
  foundingStockCover: number;
  /** Goods quantities ride ECONOMY_SCALE and money does not — the valuation seam's normaliser. */
  economyScale: number;
}

/** A faction's spending position as the affordability gate reads it: what it has free to commit, and
 *  the last settlement's maintenance bill the charter is quoted off. */
export interface ColonyFoundingBudget {
  /** Working balance — for the tick path, `balance − pendingFounding`. */
  balance: number;
  /** `lastSettlement.maintenanceBill`; 0 before a faction has ever settled (the charter floor covers it). */
  maintenanceBill: number;
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

/** Seed + bundled-housing sizing for a colony at `peopleLand` — the planner's whole-level rule,
 *  shared with the player's direct-colony verb so both order identical projects. Null = the site
 *  can't hold one whole housing level (not viable).
 *
 *  Housing is sized to exactly the seed's own need, so `popCap ≥ seedPop` on arrival with no spare
 *  level bundled. What contains it is the whole-level round-up: `ceil` leaves strictly less than one
 *  level vacant, and the idle channel only fires on a WHOLE idle level. A bundled headroom level put
 *  a fresh colony a full level above its own occupancy, which reads idle from the moment it lands and
 *  is torn down before the colony can grow into it; the second level is earned from the housing
 *  relief valve like any other system's.
 *
 *  The containment holds against the seed as SIZED. `applyDevelopments` delivers
 *  `min(seedPop, source spare)`, so a short delivery leaves the colony emptier than this assumed —
 *  harmless while `housingLevels` is 1 (a single level is never a whole idle level under any
 *  positive population), which the shipped seed guarantees. Scaling the seed against the housing
 *  unit is a parked idea (docs/ROADMAP.md, "Colony seed size scaled against the housing unit") that
 *  would break that, and must revisit this.
 *
 *  The `maxHousingLevels` clamp is redundant with the seed clamp above it — `seedPop` is already
 *  capped to `maxHousingLevels × POP_CENTRE_DENSITY`, so the round-up can never exceed the land. It
 *  is kept as a guard so the two clamps cannot drift apart silently. */
export interface ColonySizing { seedPop: number; housingLevels: number; work: number }

export function sizeColonyEstablish(
  peopleLand: number,
  params: Pick<ColonyEstablishParams, "seedPop" | "establishWork">,
): ColonySizing | null {
  const housingCost = effectiveSpaceCost(HOUSING_TYPE);
  const maxHousingLevels = housingCost > 0 ? Math.floor(Math.max(0, peopleLand) / housingCost) : 0;
  const habitableCap = maxHousingLevels * POP_CENTRE_DENSITY;
  const seedPop = Math.min(params.seedPop, habitableCap);
  const housingLevels = Math.min(maxHousingLevels, Math.ceil(seedPop / POP_CENTRE_DENSITY));
  const work = params.establishWork + housingLevels * workCostPerLevel(HOUSING_TYPE);
  // `Number.isFinite` and not `< 1` alone: every comparison against NaN is false, so a NaN
  // peopleLand would slip past the viability guard and put NaN seedPop/housingLevels/work into a
  // construction project and thence into a save, where JSON.stringify turns them into null. `work`
  // is checked on its own account rather than inferred from the other two — it also carries
  // `establishWork` straight from the caller.
  if (!Number.isFinite(housingLevels) || !Number.isFinite(seedPop) || !Number.isFinite(work)) return null;
  if (housingLevels < 1 || seedPop <= 0) return null;
  return { seedPop, housingLevels, work };
}

/**
 * The pre-gate colony assessment: score each controlled candidate on the same demand-rate axis as a
 * build (docs/active/gameplay/colonisation.md), with no funding applied. Faction-level aggregates
 * (territory saturation σ, and the unmet demand each missing resource unblocks) are computed once from the
 * faction's DEVELOPED systems; each candidate is then valued with `colonyValue` and sized to its land —
 * seed capped to the whole-level habitable capacity and housing sized to house it, so the landed colony has
 * `popCap ≥ seedPop` (viable by construction). A candidate already being established (open project),
 * below the habitable floor / lacking a whole housing level, or worth less than the labour its seed
 * drains is skipped. The `Map`/`Set` aggregates are transient — nothing here reaches `World` state.
 *
 * This assessment is what `WorldSystem.colonyOpportunity` persists — an opportunity the faction
 * cannot yet afford is still an opportunity — while `planFactionColonyProposals` below applies the
 * money and settler gates to decide what actually gets founded.
 */
export function assessColonyCandidates(
  factionId: string,
  developed: BuildSystemState[],
  candidates: ColonyEstablishCandidate[],
  openColonyProjects: WorldColonyEstablishProject[],
  params: ColonyEstablishParams,
): ColonyProposal[] {
  if (candidates.length === 0) return [];

  const factionSystems: FactionSystemState[] = developed.map((s) => ({
    buildings: s.buildings, peopleLand: s.peopleLand, depositCounts: s.depositCounts,
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
    if (c.peopleLand < params.habitableFloor) continue; // below one whole housing level of land

    // Land-sized seed + bundled housing, on WHOLE housing levels so popCap ≥ seedPop exactly (no rounding
    // gap): seed capped to the whole-level habitable capacity; housing sized to house it, land-bounded.
    const sizing = sizeColonyEstablish(c.peopleLand, params);
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
  return proposals;
}

/**
 * What the faction actually founds: the assessment above, truncated by two budgets. Both are prefix
 * truncations of the one value-descending order, so composing them is order-independent — the result
 * is the shorter prefix either way. The MONEY gate (`budget`, omitted ⇒ founding is unpriced: the
 * engine-test and independents path) walks the order with a running balance, spending each
 * acceptance's own `charter + headroom × projected material bill` and ending the list at the first
 * candidate it cannot cover. The SETTLER-SUPPLY gate below it caps the count against drawable
 * labour. Beyond those there is no per-cycle cap: every affordable candidate is proposed and the pool
 * decides which advance (a proposal persists as an in-flight project only once funded — enforced by
 * the processor's persist-if-funded).
 */
export function planFactionColonyProposals(
  factionId: string,
  developed: BuildSystemState[],
  candidates: ColonyEstablishCandidate[],
  openColonyProjects: WorldColonyEstablishProject[],
  params: ColonyEstablishParams,
  budget?: ColonyFoundingBudget,
): ColonyProposal[] {
  const proposals = assessColonyCandidates(factionId, developed, candidates, openColonyProjects, params);

  // What committing to each candidate would cost in money, by target system. The charter is the same
  // for every candidate a faction weighs (it is quoted off the faction's own maintenance bill), so
  // only the material projection varies. The projection is deliberately the UNCAPPED want: what the
  // founder will actually be able to spare over the establish's life is not knowable at commitment,
  // and over-reserving is the safe direction. A source outside the developed set contributes no
  // material projection — its market rows are not visible — leaving the charter as the whole quote
  // for that candidate.
  const commitmentCostBySystem = new Map<string, number>();
  if (budget !== undefined && proposals.length > 0) {
    const bySystemId = new Map(developed.map((s) => [s.systemId, s]));
    const charter = charterFee(budget.maintenanceBill, { mult: params.charterMult, min: params.charterMin });
    for (const p of proposals) {
      const projectedBill = foundingGoodsValue(
        projectedManifestWant(bySystemId.get(p.sourceSystemId)?.goods ?? [], p.seedPop, params.foundingStockCover),
        params.economyScale,
      );
      commitmentCostBySystem.set(p.systemId, foundingCommitmentCost(charter, projectedBill, params.gateHeadroom));
    }
  }

  // Affordability gate: a candidate is proposed only while the faction's working balance still covers
  // committing to it — the charter it pays at commitment plus headroom for the materials it will owe
  // as it builds. The balance is a REAL running budget down the value order: each acceptance spends
  // its own commitment cost and the first candidate the remainder cannot cover ends the list. Without
  // the running decrement a faction that can afford one colony commits several and pays several
  // charters — the same problem the per-source stock balance solves on the goods side. Money never
  // enters `colonyValue`: an enabler gates eligibility, it does not change what a colony is worth.
  const affordable = ((): ColonyProposal[] => {
    if (budget === undefined || proposals.length === 0) return proposals;
    let remaining = Number.isFinite(budget.balance) ? budget.balance : 0;
    const kept: ColonyProposal[] = [];
    for (const p of [...proposals].sort((a, b) => b.value - a.value)) {
      const cost = commitmentCostBySystem.get(p.systemId) ?? 0;
      if (cost > remaining) break;
      remaining -= cost;
      kept.push(p);
    }
    return kept;
  })();

  // Settler-supply founding gate: a faction only opens new colonies while it can still deliver its
  // minimum settler supply to each colony it is ALREADY trying to fill (+ each new one). Releasable
  // settler flow this cycle = idle spare labour + the always-on employed leak, summed over developed
  // systems; "hungry" absorbers are developed systems still below their housing cap, PLUS every
  // establish still in flight. Counting the in-flight ones is what makes the gate's strength
  // independent of how long an establish takes: a forming colony is `controlled`, so it is invisible
  // to the developed-systems loop, and a longer forming window would otherwise let a faction hold
  // more and more concurrent foundings against the same settler supply. Founding is capped to
  // `floor(releasable / minSettlerSupply) − hungry` best-valued candidates, so a faction fills what
  // it has before it sprawls into colonies it can never populate. `minSettlerSupply ≤ 0` disables
  // the gate.
  if (params.minSettlerSupply <= 0 || affordable.length === 0) return affordable;
  let releasable = 0;
  let hungry = openColonyProjects.length;
  for (const s of developed) {
    const ld = labourDemand(s.buildings);
    const staffed = Math.min(Math.max(0, s.population), Math.max(0, ld));
    releasable += Math.max(0, s.population - ld) + params.employedLeakFraction * staffed;
    if (s.population < housingPopCap(s.buildings)) hungry++;
  }
  const settlerBudget = Math.max(0, Math.floor(releasable / params.minSettlerSupply) - hungry);
  if (settlerBudget >= affordable.length) return affordable;
  return [...affordable].sort((a, b) => b.value - a.value).slice(0, settlerBudget);
}
