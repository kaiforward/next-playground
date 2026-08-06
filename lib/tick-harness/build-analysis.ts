/**
 * Colonisation / build-health analysis for the calibration harness.
 *
 * Aggregate market health can look green while the *colonisation build loop* is broken — a colony
 * flips to `developed`, receives its seed population, and then never gets housing or industry built,
 * so it sits with pops on deposits and nothing else. This summary measures that loop directly:
 * how far homeworlds vs colonies get built out, how many developed systems carry population but no
 * industry (the stranded symptom), and whether the construction queue is proposing nothing for
 * colonies (a planner/decision gap) or proposing but never funding them (a pacing/starvation gap).
 */
import type { TickSystem } from "@/lib/tick/rows";
import type { WorldConstructionProject, WorldMarket } from "@/lib/world/types";
import { GOOD_TIER_BY_KEY } from "@/lib/constants/goods";
import {
  HOUSING_TYPE, VOCATIONAL_SCHOOL_TYPE, RESEARCH_INSTITUTE_TYPE, COMPLEX_TYPES, CONSTRUCTION_CENTRE_TYPE,
} from "@/lib/constants/industry";
import { factionConstructionPool } from "@/lib/engine/construction";
import { dissatisfaction } from "@/lib/engine/population";
import { goodSatisfactionsBySystem } from "@/lib/tick-harness/good-satisfaction";
import { CONSTRUCTION } from "@/lib/constants/construction";
import { CONSTRUCTION_INTERVAL } from "@/lib/constants/tick-cadence";
import { DIRECTED_BUILD } from "@/lib/constants/directed-build";
import { median } from "@/lib/utils/math";
import type { FoundingStagingEvent } from "@/lib/tick/types";
import type { BuildBurstSummary, FoundingStockSummary } from "./types";

/** How a developed system's built base breaks down by role/tier. */
interface BuildBreakdown {
  tier0: number; // extractor levels (deposit-slot goods)
  tier1: number; // processed-good factory levels
  tier2: number; // advanced-good factory levels
  housing: number;
  academy: number; // vocational schools + research institutes
  complex: number; // specialisation complexes
  centre: number; // construction centres
}

function breakdown(buildings: Record<string, number>): BuildBreakdown {
  const b: BuildBreakdown = { tier0: 0, tier1: 0, tier2: 0, housing: 0, academy: 0, complex: 0, centre: 0 };
  for (const [type, count] of Object.entries(buildings)) {
    if (count <= 0) continue;
    if (type === HOUSING_TYPE) { b.housing += count; continue; }
    if (type === VOCATIONAL_SCHOOL_TYPE || type === RESEARCH_INSTITUTE_TYPE) { b.academy += count; continue; }
    if (COMPLEX_TYPES.includes(type)) { b.complex += count; continue; }
    if (type === CONSTRUCTION_CENTRE_TYPE) { b.centre += count; continue; }
    const tier = GOOD_TIER_BY_KEY[type];
    if (tier === 0) b.tier0 += count;
    else if (tier === 1) b.tier1 += count;
    else if (tier === 2) b.tier2 += count;
  }
  return b;
}

/** Per-class (homeworld / colony) build-out counts across developed systems. */
export interface ClassBuildStats {
  count: number;
  /** Developed systems in this class that host ≥1 production level of the given kind. */
  withTier0: number;
  withTier1Plus: number;
  withHousing: number;
  /** Developed systems carrying population but ZERO production levels (the stranded symptom). */
  populatedButNoIndustry: number;
  /** Developed systems with population but popCap ≈ 0 — housing never built, pop can't grow or be housed. */
  popCapStarved: number;
  totalPopulation: number;
  /** Deposit-bearing systems (Σ slotCap > 0) in this class with no tier-0 extraction built. */
  depositsIdle: number;
}

/** A colony founded during the run, with the state of its first fully assessed cycle. */
export interface FoundedColonyRecord {
  systemId: string;
  foundedTick: number;
  /** Demand-weighted satisfaction at that cycle; null until sampled. */
  openingSatisfaction: number | null;
  /** The convex fold unrest itself reads (`dissatisfaction`) at that cycle; null until sampled. */
  openingDissatisfaction: number | null;
  /** Total tonnage the colony staged from its founder over the whole establish; absent when it
   *  staged nothing. */
  manifestTonnage?: number;
  /** What the faction paid for those materials through the founding valuation seam, over the whole
   *  establish (the charter is not part of it); absent when it staged nothing. */
  foundingMoneyCost?: number;
  /** The founder's remaining cover on the binding good — post-draw stock ÷ that good's donor floor —
   *  taken as the MINIMUM ACROSS THE COLONY'S STAGING DRAWS, i.e. the deepest any one cycle's draw
   *  left it. Below 1 means founding drew the founder under the floor it is meant to keep for
   *  itself. Absent when no draw gave a measurable reading (no staged good with a positive donor
   *  floor).
   *
   *  A different unit from the pre-staging reading of the same name, which measured one whole
   *  manifest taken in a single draw at the founding tick: a run's figure here is not comparable
   *  with one measured before materials were staged per cycle. */
  founderCoverAfter?: number;
}

/**
 * What one colony has staged from its founder so far — the running total behind its record.
 *
 * Kept keyed by TARGET SYSTEM and independent of the founded-colony tracker, because every staging
 * draw fires while the target is still `controlled`: a tracker-keyed recorder would drop every draw
 * made before the colony existed, which is all of them but the last.
 */
export interface FoundingStagingTotals {
  tonnage: number;
  moneyCost: number;
  /** Minimum cover across the draws that had a measurable one; absent while none has. */
  minFounderCover?: number;
}

/** One cycle's staging draw as the processor emits it (`instrumentation.foundingManifests`). */
export type FoundingStagingRecord = Pick<
  FoundingStagingEvent, "systemId" | "tonnage" | "moneyCost" | "founderCover"
>;

/**
 * Accumulate one staging draw against its target colony. Called for every draw as it happens; the
 * totals are folded into the colony's record when `trackFoundedColonies` first sees it developed.
 * A draw that moved nothing is ignored, so a colony that never staged has no entry at all and
 * contributes no cover reading rather than a 0 one.
 */
export function recordFoundingManifest(
  staging: Map<string, FoundingStagingTotals>,
  draw: FoundingStagingRecord,
): void {
  if (!(draw.tonnage > 0)) return;
  const totals = staging.get(draw.systemId) ?? { tonnage: 0, moneyCost: 0 };
  totals.tonnage += draw.tonnage;
  // A non-finite money cost is a corrupt reading, not a free draw — counting it would poison every
  // later sum with a NaN. The tonnage still stands.
  if (Number.isFinite(draw.moneyCost)) totals.moneyCost += Math.max(0, draw.moneyCost);
  // A cover with nothing measurable behind it stays absent — folding a placeholder 0 into the
  // median would read as a founder drained flat, the opposite of "there was no floor to draw
  // under". Same rule for a corrupt (non-finite) reading.
  if (draw.founderCover !== undefined && Number.isFinite(draw.founderCover)) {
    const cover = Math.max(0, draw.founderCover);
    totals.minFounderCover =
      totals.minFounderCover === undefined ? cover : Math.min(totals.minFounderCover, cover);
  }
  staging.set(draw.systemId, totals);
}

/** Opening satisfaction below this reads as a colony that arrived deprived. */
const OPENING_DEPRIVED_SATISFACTION = 0.5;

/** The fields a founded colony's opening reading needs off its system row. */
export type FoundedColonySystem =
  Pick<TickSystem, "id" | "control" | "population" | "buildings">;

/**
 * Record every colony founded during the run — a system that becomes `developed` after tick 0. The
 * founding-stock endowment exists so a colony does not open starving, and a handful of brand-new
 * systems is invisible to any galaxy-wide average, so it has to be caught as it happens.
 *
 * Detection only; the reading itself is `sampleFoundedColonies` at the first economy cycle STRICTLY
 * after the founding tick, so it covers a whole assessed cycle of the colony's life rather than
 * however much of one remained when it landed.
 *
 * This is also where a colony's staging totals join its record — every draw it made happened before
 * it existed as a colony, so the accumulator is the only place they can have been kept. Feed the
 * tick's draws in before calling this, or the founding cycle's own draw misses the fold.
 */
export function trackFoundedColonies(
  systems: ReadonlyArray<Pick<TickSystem, "id" | "control">>,
  tick: number,
  developedAtStart: ReadonlySet<string>,
  tracker: Map<string, FoundedColonyRecord>,
  staging: ReadonlyMap<string, FoundingStagingTotals>,
): void {
  for (const s of systems) {
    if (s.control !== "developed" || developedAtStart.has(s.id) || tracker.has(s.id)) continue;
    const staged = staging.get(s.id);
    tracker.set(s.id, {
      systemId: s.id, foundedTick: tick, openingSatisfaction: null, openingDissatisfaction: null,
      manifestTonnage: staged?.tonnage,
      foundingMoneyCost: staged?.moneyCost,
      founderCoverAfter: staged?.minFounderCover,
    });
  }
}

/** Is any tracked colony waiting for a reading it could take on this tick? */
export function hasColonyAwaitingSample(
  tracker: ReadonlyMap<string, FoundedColonyRecord>,
  tick: number,
): boolean {
  for (const r of tracker.values()) {
    if (r.openingSatisfaction === null && r.foundedTick < tick) return true;
  }
  return false;
}

/**
 * Take the opening reading for every tracked colony whose first post-founding economy cycle is this
 * tick. Call only on an economy cycle — satisfaction is written by that cycle and is unchanged between.
 */
export function sampleFoundedColonies(
  systems: ReadonlyArray<FoundedColonySystem>,
  markets: ReadonlyArray<Pick<WorldMarket, "systemId" | "goodId" | "satisfaction">>,
  tick: number,
  tracker: Map<string, FoundedColonyRecord>,
): void {
  const due = new Map<string, FoundedColonySystem>();
  for (const r of tracker.values()) {
    if (r.openingSatisfaction !== null || r.foundedTick >= tick) continue;
    const sys = systems.find((s) => s.id === r.systemId);
    if (sys) due.set(r.systemId, sys);
  }
  if (due.size === 0) return;

  // Weighted by each good's share of the COLONY's own demand, and folded with the same
  // `dissatisfaction` the unrest engine reads. A flat mean over the basket would call a seed colony
  // with no reactor cores as deprived as one with no water, and then disagree with the simulation.
  const goodsBySystem = goodSatisfactionsBySystem(due, markets);
  for (const [systemId, goods] of goodsBySystem) {
    const record = tracker.get(systemId);
    if (!record || goods.length === 0) continue;
    let totalDemand = 0;
    for (const g of goods) totalDemand += Math.max(0, g.demanded);
    if (totalDemand <= 0) continue;
    let weighted = 0;
    for (const g of goods) weighted += (Math.max(0, g.demanded) / totalDemand) * g.satisfaction;
    record.openingSatisfaction = weighted;
    record.openingDissatisfaction = dissatisfaction(goods);
  }
}

/** Fold the tracked colonies into the run's founding-stock health reading. */
export function summarizeFoundingStock(
  tracker: ReadonlyMap<string, FoundedColonyRecord>,
): FoundingStockSummary {
  let sampledCount = 0;
  let satisfactionSum = 0;
  let dissatisfactionSum = 0;
  let openingDeprivedCount = 0;
  let manifestTonnageSum = 0;
  let moneyCostSum = 0;
  const founderCovers: number[] = [];
  for (const r of tracker.values()) {
    manifestTonnageSum += r.manifestTonnage ?? 0;
    moneyCostSum += r.foundingMoneyCost ?? 0;
    // Only a colony that actually drew a manifest says anything about the cost to its founder.
    if (r.founderCoverAfter !== undefined) founderCovers.push(r.founderCoverAfter);
    if (r.openingSatisfaction === null || r.openingDissatisfaction === null) continue;
    sampledCount++;
    satisfactionSum += r.openingSatisfaction;
    dissatisfactionSum += r.openingDissatisfaction;
    if (r.openingSatisfaction < OPENING_DEPRIVED_SATISFACTION) openingDeprivedCount++;
  }
  return {
    foundedCount: tracker.size,
    sampledCount,
    meanOpeningSatisfaction: sampledCount > 0 ? satisfactionSum / sampledCount : 0,
    meanOpeningDissatisfaction: sampledCount > 0 ? dissatisfactionSum / sampledCount : 0,
    openingDeprivedCount,
    // Denominated over every colony founded, so a run that ships nothing reads 0 rather than
    // hiding behind a shrunken denominator.
    meanManifestTonnage: tracker.size > 0 ? manifestTonnageSum / tracker.size : 0,
    meanFoundingMoneyCost: tracker.size > 0 ? moneyCostSum / tracker.size : 0,
    medianFounderCoverAfter: founderCovers.length > 0 ? median(founderCovers) : null,
  };
}

export interface ColonisationSummary {
  homeworld: ClassBuildStats;
  colony: ClassBuildStats;
  /** Open construction projects, split by target-system class, to tell "proposes nothing" from "never funds". */
  queue: {
    homeworldProjects: number;
    colonyProjects: number;
    homeworldLevels: number;
    colonyLevels: number;
    /** Mean workDone/workTotal over colony-targeted projects (low + persistent ⇒ funding starvation). */
    colonyMeanProgress: number;
    /** Colony-targeted projects by kind, to see whether housing/tier-0 are even being proposed. */
    colonyByKind: Record<string, number>;
  };
}

function slotCapTotal(s: TickSystem): number {
  let n = 0;
  for (const v of Object.values(s.slotCap)) n += Math.max(0, v);
  return n;
}

function emptyClass(): ClassBuildStats {
  return {
    count: 0, withTier0: 0, withTier1Plus: 0, withHousing: 0,
    populatedButNoIndustry: 0, popCapStarved: 0, totalPopulation: 0, depositsIdle: 0,
  };
}

function projectKind(buildingType: string): string {
  if (buildingType === HOUSING_TYPE) return "housing";
  if (buildingType === VOCATIONAL_SCHOOL_TYPE || buildingType === RESEARCH_INSTITUTE_TYPE) return "academy";
  if (COMPLEX_TYPES.includes(buildingType)) return "complex";
  if (buildingType === CONSTRUCTION_CENTRE_TYPE) return "centre";
  const tier = GOOD_TIER_BY_KEY[buildingType];
  return tier === 0 ? "tier0" : tier === 1 ? "tier1" : tier === 2 ? "tier2" : "other";
}

/**
 * Summarise the colonisation build loop from the final world. `homeworldIds` are the
 * per-faction seeded homeworlds (`world.factions[].homeworldId`); every other developed
 * system is a colony.
 */
export function summarizeColonisation(
  systems: TickSystem[],
  homeworldIds: Set<string>,
  projects: WorldConstructionProject[],
): ColonisationSummary {
  const homeworld = emptyClass();
  const colony = emptyClass();

  for (const s of systems) {
    if (s.control !== "developed") continue;
    const cls = homeworldIds.has(s.id) ? homeworld : colony;
    const b = breakdown(s.buildings);
    const industry = b.tier0 + b.tier1 + b.tier2;

    cls.count++;
    cls.totalPopulation += s.population;
    if (b.tier0 > 0) cls.withTier0++;
    if (b.tier1 + b.tier2 > 0) cls.withTier1Plus++;
    if (b.housing > 0) cls.withHousing++;
    if (s.population > 1 && industry <= 0) cls.populatedButNoIndustry++;
    if (s.population > 1 && s.popCap < 1) cls.popCapStarved++;
    if (slotCapTotal(s) > 0 && b.tier0 <= 0) cls.depositsIdle++;
  }

  const homeworldSet = homeworldIds;
  let homeworldProjects = 0, colonyProjects = 0, homeworldLevels = 0, colonyLevels = 0;
  let colonyProgressSum = 0;
  const colonyByKind: Record<string, number> = {};
  for (const p of projects) {
    if (p.kind !== "build") continue; // colony-establish reporting lands in PR4
    const isHome = homeworldSet.has(p.systemId);
    if (isHome) { homeworldProjects++; homeworldLevels += p.levels; }
    else {
      colonyProjects++;
      colonyLevels += p.levels;
      colonyProgressSum += p.workTotal > 0 ? p.workDone / p.workTotal : 0;
      const kind = projectKind(p.buildingType);
      colonyByKind[kind] = (colonyByKind[kind] ?? 0) + 1;
    }
  }

  return {
    homeworld,
    colony,
    queue: {
      homeworldProjects,
      colonyProjects,
      homeworldLevels,
      colonyLevels,
      colonyMeanProgress: colonyProjects > 0 ? colonyProgressSum / colonyProjects : 0,
      colonyByKind,
    },
  };
}

/** Galaxy-wide construction-pool composition + queue pressure — starvation made visible. */
export interface ConstructionPoolSummary {
  poolBase: number;
  poolCentres: number;
  /** poolCentres / (poolBase + poolCentres); 0 when the pool is empty. */
  centreShare: number;
  /** Built centre levels across developed systems. */
  centreLevels: number;
  /** Open centre build projects. */
  centreProjects: number;
  /** Σ max(0, workTotal − workDone) over all open projects. */
  queueRemainingWork: number;
  /** Cycles to drain the whole open queue at the current total pool; null when the pool is 0. */
  queueEtaCycles: number | null;
}

/**
 * Pool composition (eligible-heads base vs Construction Centre output) and how many cycles the open
 * queue takes to drain at that rate. Composition aggregates linearly over developed systems, so one
 * pass over the whole galaxy equals the per-faction sum.
 */
export function summarizeConstructionPool(
  systems: TickSystem[],
  projects: WorldConstructionProject[],
): ConstructionPoolSummary {
  const pool = factionConstructionPool(
    systems.map((s) => ({ control: s.control, population: s.population, buildings: s.buildings })),
    { throughputPerPop: CONSTRUCTION.THROUGHPUT_PER_POP, pointsPerLevel: CONSTRUCTION.POINTS_PER_LEVEL },
  );
  let centreLevels = 0;
  for (const s of systems) {
    if (s.control === "developed") centreLevels += s.buildings[CONSTRUCTION_CENTRE_TYPE] ?? 0;
  }
  let centreProjects = 0;
  let queueRemainingWork = 0;
  for (const p of projects) {
    queueRemainingWork += Math.max(0, p.workTotal - p.workDone);
    if (p.kind === "build" && p.buildingType === CONSTRUCTION_CENTRE_TYPE) centreProjects++;
  }
  return {
    poolBase: pool.base,
    poolCentres: pool.centres,
    centreShare: pool.total > 0 ? pool.centres / pool.total : 0,
    centreLevels,
    centreProjects,
    queueRemainingWork,
    queueEtaCycles: pool.total > 0 ? queueRemainingWork / pool.total : null,
  };
}

/**
 * One tick's directed-build commitment for a single good — the flat record the harness
 * accumulates across the whole run. Mirrors `WorldFlowEvent`'s role for `summarizeLogistics`:
 * a cycle's per-good levels are gone the moment the tick returns (never persisted in `World`,
 * per `runWorldTick().instrumentation`'s contract), so the harness must capture each cycle as it
 * happens rather than reading the final world.
 */
export interface BuildCommitmentRecord {
  tick: number;
  goodId: string;
  levels: number;
}

/**
 * Ticks below which a quiet burst section reads as construction warm-up, not a broken directed-build wire.
 * A structural deficit becomes a fundable proposal only after it survives the two-reference-cycle
 * persistence window (`DIRECTED_BUILD.PERSISTENCE_CYCLES`), and the first construction cycle lands at
 * `CONSTRUCTION_INTERVAL` — so nothing autonomic can commit before roughly interval × (1 + persistence)
 * ticks. This is the cadence floor; colony-driven bursts lag further, behind colonisation. A legibility
 * bound, not a correctness one — below it, low activity means "too early", not "broken" (which the block's
 * own NOTHING-COMMITTED line still flags).
 */
export const CONSTRUCTION_WARMUP_TICKS = CONSTRUCTION_INTERVAL * (1 + DIRECTED_BUILD.PERSISTENCE_CYCLES);

/**
 * Summarise the worst per-cycle construction burst per good across a run's directed-build
 * commitments — proof that the construction rate cap (`DIRECTED_BUILD.BUILD_RATE_CAP`) actually
 * bounds new-proposal velocity, rather than merely asserting it exists. A silent run (no builds
 * committed) reports zero/null, never NaN or an empty-array crash.
 */
export function summarizeBuildBursts(records: BuildCommitmentRecord[]): BuildBurstSummary {
  const maxByGood = new Map<string, { levels: number; tick: number }>();
  for (const r of records) {
    const best = maxByGood.get(r.goodId);
    if (!best || r.levels > best.levels) maxByGood.set(r.goodId, { levels: r.levels, tick: r.tick });
  }

  const byGood = [...maxByGood.entries()]
    .map(([goodId, best]) => ({ goodId, maxLevelsPerCycle: best.levels, tick: best.tick }))
    .sort((a, b) => b.maxLevelsPerCycle - a.maxLevelsPerCycle || a.goodId.localeCompare(b.goodId));

  if (byGood.length === 0) {
    return { byGood, globalMax: 0, worstGood: null, worstTick: null };
  }
  const worst = byGood[0];
  return { byGood, globalMax: worst.maxLevelsPerCycle, worstGood: worst.goodId, worstTick: worst.tick };
}
