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
import { dissatisfaction, provision } from "@/lib/engine/population";
import { goodSatisfactionsBySystem } from "@/lib/tick-harness/good-satisfaction";
import { CONSTRUCTION } from "@/lib/constants/construction";
import { CONSTRUCTION_INTERVAL } from "@/lib/constants/tick-cadence";
import { DIRECTED_BUILD } from "@/lib/constants/directed-build";
import { median, quantile } from "@/lib/utils/math";
import type { FoundingStagingEvent, FoundingStallEvent } from "@/lib/tick/types";
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
  /** The fold unrest itself reads (`dissatisfaction`, 1 − Provision on the linear scale) at that
   *  cycle; null until sampled. */
  openingShortfall: number | null;
  /** `provision()` — the necessity-and-demand-weighted MEAN satisfaction — over the same basket as
   *  the two readings above; null until sampled. Differs from `openingSatisfaction` whenever a good's
   *  demand share and its necessity disagree: `openingSatisfaction` weights by demand alone,
   *  `openingProvision` by demand × necessity. Deliberately NOT `provision()`'s own empty-basket ≡ 1
   *  reading — an empty basket at sampling leaves this null (see `sampleFoundedColonies`), because
   *  "could not measure" and "opened perfectly supplied" are opposite readings. */
  openingProvision: number | null;
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
   *  with one measured before materials were staged per cycle.
   *
   *  Queue-order dependent within a cycle, and so not a pure per-colony attribution: a draw is
   *  measured against what the founder holds after every draw already made on it this cycle,
   *  including other colonies'. A colony the queue reaches second reads deeper than the same
   *  colony would have read first. */
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
      systemId: s.id, foundedTick: tick,
      openingSatisfaction: null, openingShortfall: null, openingProvision: null,
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

/** Is any tracked colony still inside the founding-trajectory window on this tick? Mirrors
 *  `hasColonyAwaitingSample`'s job for `sampleFoundingTrajectory`: the runner builds full tick
 *  rows only when a repeated trajectory reading is actually due, not on every cycle. */
export function hasColonyInTrajectoryWindow(
  tracker: ReadonlyMap<string, FoundedColonyRecord>,
  tick: number,
  cycleLength: number,
): boolean {
  if (cycleLength <= 0) return false;
  const windowCycles = FOUNDING_TRAJECTORY_BUCKET_COUNT * FOUNDING_TRAJECTORY_BUCKET_CYCLES;
  for (const r of tracker.values()) {
    const ageTicks = tick - r.foundedTick;
    // Same tick as founding (or later, same tick): nothing is due yet — the first real reading is
    // the first cycle STRICTLY after founding, matching `sampleFoundedColonies` and
    // `sampleFoundingTrajectory` below.
    if (ageTicks <= 0) continue;
    if (Math.floor(ageTicks / cycleLength) < windowCycles) return true;
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
    record.openingShortfall = dissatisfaction(goods);
    record.openingProvision = provision(goods);
  }
}

/**
 * Share of a run's founded colonies the cadence mark is taken at. The acceptance bar reads the
 * founding BURST's spread, and the burst's tail is what a pacing change moves — the median barely
 * shifts while the 80% mark slides by hundreds of ticks.
 */
export const FOUNDING_CADENCE_MARK_SHARE = 0.8;

/**
 * The tick by which `share` of the run's founded colonies had been founded — the cadence mark the
 * gate compares arms on.
 *
 * Denominated over the run's OWN total, so it says when this arm's burst had mostly happened rather
 * than when it reached some absolute count. That makes it a pacing read and not a volume one: an arm
 * that founds half as many colonies at the same rhythm reads the same mark.
 *
 * Order-independent by construction — the ticks are sorted, so the answer cannot depend on the order
 * colonies happened to be tracked in. Null when nothing was founded: there is no mark, and a 0 would
 * read as "the whole burst landed on tick zero", the opposite of what happened.
 */
export function foundingCadenceMarkTick(
  tracker: ReadonlyMap<string, FoundedColonyRecord>,
  share: number = FOUNDING_CADENCE_MARK_SHARE,
): number | null {
  const ticks: number[] = [];
  for (const r of tracker.values()) ticks.push(r.foundedTick);
  if (ticks.length === 0) return null;
  ticks.sort((a, b) => a - b);
  // The colonies needed to reach the share, in whole colonies — the mark is a real founding's tick,
  // never an interpolation between two. The epsilon keeps an exact share (0.8 × 5 = 4) off the wrong
  // side of a float comparison.
  const needed = Math.min(ticks.length, Math.max(1, Math.ceil(share * ticks.length - 1e-9)));
  return ticks[needed - 1];
}

/** Fold the tracked colonies into the run's founding-stock health reading. */
export function summarizeFoundingStock(
  tracker: ReadonlyMap<string, FoundedColonyRecord>,
): FoundingStockSummary {
  let sampledCount = 0;
  let satisfactionSum = 0;
  let shortfallSum = 0;
  let provisionSum = 0;
  const provisions: number[] = [];
  let openingDeprivedCount = 0;
  let manifestTonnageSum = 0;
  let moneyCostSum = 0;
  const founderCovers: number[] = [];
  for (const r of tracker.values()) {
    manifestTonnageSum += r.manifestTonnage ?? 0;
    moneyCostSum += r.foundingMoneyCost ?? 0;
    // Only a colony that actually drew a manifest says anything about the cost to its founder.
    if (r.founderCoverAfter !== undefined) founderCovers.push(r.founderCoverAfter);
    if (r.openingSatisfaction === null || r.openingShortfall === null || r.openingProvision === null) {
      continue;
    }
    sampledCount++;
    satisfactionSum += r.openingSatisfaction;
    shortfallSum += r.openingShortfall;
    provisionSum += r.openingProvision;
    provisions.push(r.openingProvision);
    if (r.openingSatisfaction < OPENING_DEPRIVED_SATISFACTION) openingDeprivedCount++;
  }
  return {
    foundedCount: tracker.size,
    sampledCount,
    meanOpeningSatisfaction: sampledCount > 0 ? satisfactionSum / sampledCount : 0,
    meanOpeningShortfall: sampledCount > 0 ? shortfallSum / sampledCount : 0,
    // Null rather than 0 when nothing was sampled — the founding invariant reads this as THE
    // measured founding Provision, and a run that founded nothing has no such reading to give.
    meanOpeningProvision: sampledCount > 0 ? provisionSum / sampledCount : null,
    p10OpeningProvision: sampledCount > 0 ? quantile(provisions, 0.1) : null,
    // The literal minimum, over the SAME samples p10/mean read — not derived from p10, which
    // bounds only 90% of the cohort. Promise 1's tail check needs the worst actual reading: p10 can
    // sit well above the true minimum whenever the bottom decile itself has spread.
    minOpeningProvision: sampledCount > 0 ? Math.min(...provisions) : null,
    openingDeprivedCount,
    // Denominated over every colony founded, so a run that ships nothing reads 0 rather than
    // hiding behind a shrunken denominator.
    meanManifestTonnage: tracker.size > 0 ? manifestTonnageSum / tracker.size : 0,
    meanFoundingMoneyCost: tracker.size > 0 ? moneyCostSum / tracker.size : 0,
    medianFounderCoverAfter: founderCovers.length > 0 ? median(founderCovers) : null,
    cadenceMarkShare: FOUNDING_CADENCE_MARK_SHARE,
    cadenceMarkTick: foundingCadenceMarkTick(tracker),
  };
}

// ── Founding trajectory: Provision and unrest over colony age, not just at opening ──────
//
// `summarizeFoundingStock` above reads ONE snapshot per colony — its first assessed cycle. Unrest promise
// 1's window half (docs/active/gameplay/economy.md) covers the whole ~60-cycle dowry +
// resignation period, including the manifest-exhaustion transition the opening snapshot cannot see
// at all: a colony that opens calm and then dips as its founding stock (`FOUNDING_STOCK_COVER`)
// runs out is invisible to a single opening read. This tracks the SAME founded-colony roster
// (`FoundedColonyRecord.foundedTick`) across repeated readings, bucketed by age since founding.

/** Width of one trajectory bucket, in economy CYCLES (not ticks) since founding. */
export const FOUNDING_TRAJECTORY_BUCKET_CYCLES = 10;

/** Bucket count — 6 × 10 cycles spans 60 cycles, promise 1's whole stated window (dowry +
 *  resignation). A colony older than that has left the window this instrument reads; the promise
 *  makes no claim about it. */
export const FOUNDING_TRAJECTORY_BUCKET_COUNT = 6;

/** The fields a founding-trajectory sample needs off its system row — the same demand basis
 *  `sampleFoundedColonies` reads, plus `unrest` (the opening read never needed it). */
export type FoundingTrajectorySystem = Pick<TickSystem, "id" | "population" | "buildings" | "unrest">;

interface TrajectoryBucketAccumulator {
  provisions: number[];
  unrests: number[];
}

/** Running per-bucket samples across a run — index `i` covers cycles
 *  `[i * FOUNDING_TRAJECTORY_BUCKET_CYCLES, (i + 1) * FOUNDING_TRAJECTORY_BUCKET_CYCLES)`. */
export interface FoundingTrajectoryTotals {
  buckets: TrajectoryBucketAccumulator[];
}

export function newFoundingTrajectoryTotals(): FoundingTrajectoryTotals {
  return {
    buckets: Array.from({ length: FOUNDING_TRAJECTORY_BUCKET_COUNT }, () => ({ provisions: [], unrests: [] })),
  };
}

/**
 * Sample every tracked colony still inside the trajectory window (age < the whole bucketed span) at
 * this cycle, bucketing by AGE SINCE FOUNDING (`tick - foundedTick`, in whole cycles) — never by
 * absolute tick, which would put a colony founded mid-run in the wrong bucket entirely and make two
 * colonies founded at different times incomparable. The first sample for a colony is the first cycle
 * STRICTLY AFTER its founding tick — the founding tick itself carries the market-seeding placeholder
 * satisfaction (1.0), not a lived reading, so it contributes nothing here, matching
 * `sampleFoundedColonies`'s own "STRICTLY after the founding tick" rule. Call only on an economy
 * cycle (Provision is written by that cycle and unchanged between), same cadence as
 * `sampleFoundedColonies`.
 */
export function sampleFoundingTrajectory(
  systems: ReadonlyArray<FoundingTrajectorySystem>,
  markets: ReadonlyArray<Pick<WorldMarket, "systemId" | "goodId" | "satisfaction">>,
  tick: number,
  cycleLength: number,
  tracker: ReadonlyMap<string, FoundedColonyRecord>,
  totals: FoundingTrajectoryTotals,
): void {
  if (cycleLength <= 0) return;
  const windowCycles = FOUNDING_TRAJECTORY_BUCKET_COUNT * FOUNDING_TRAJECTORY_BUCKET_CYCLES;
  const systemsById = new Map(systems.map((s) => [s.id, s]));

  const due = new Map<string, FoundingTrajectorySystem>();
  const bucketBySystem = new Map<string, number>();
  for (const r of tracker.values()) {
    const ageTicks = tick - r.foundedTick;
    // Founded this same tick (or later, same tick): the market-seeding placeholder, not a lived
    // cycle — nothing to read yet. Matches sampleFoundedColonies.
    if (ageTicks <= 0) continue;
    const ageCycles = Math.floor(ageTicks / cycleLength);
    if (ageCycles >= windowCycles) continue; // past promise 1's window — not this instrument's claim
    const sys = systemsById.get(r.systemId);
    if (!sys) continue;
    due.set(r.systemId, sys);
    bucketBySystem.set(r.systemId, Math.floor(ageCycles / FOUNDING_TRAJECTORY_BUCKET_CYCLES));
  }
  if (due.size === 0) return;

  const goodsBySystem = goodSatisfactionsBySystem(due, markets);
  for (const [systemId, sys] of due) {
    const bucket = bucketBySystem.get(systemId);
    if (bucket === undefined) continue;
    totals.buckets[bucket].provisions.push(provision(goodsBySystem.get(systemId) ?? []));
    totals.buckets[bucket].unrests.push(sys.unrest);
  }
}

/** One age bucket's mean and p10 of Provision and unrest, over every sample taken in that bucket
 *  across the whole run (one colony contributes many samples as it ages through the bucket). */
export interface FoundingTrajectoryBucketEntry {
  /** 0-based bucket index. */
  bucket: number;
  ageStartCycles: number;
  ageEndCycles: number;
  /** Samples in this bucket — NOT a colony count: one colony contributes a sample at every economy
   *  cycle it spends inside the bucket's age span. */
  n: number;
  meanProvision: number;
  p10Provision: number;
  /** Mean and p10 of unrest. p10 reads the CALM tail (not the worst — that would be p90); reported
   *  alongside mean for the same reason Provision gets a tail reading, not because it is the more
   *  diagnostic percentile for unrest. */
  meanUnrest: number;
  p10Unrest: number;
}

export interface FoundingTrajectorySummary {
  buckets: FoundingTrajectoryBucketEntry[];
}

function bucketStats(values: number[]): { mean: number; p10: number } {
  if (values.length === 0) return { mean: 0, p10: 0 };
  return { mean: values.reduce((a, b) => a + b, 0) / values.length, p10: quantile(values, 0.1) };
}

export function summarizeFoundingTrajectory(totals: FoundingTrajectoryTotals): FoundingTrajectorySummary {
  const buckets = totals.buckets.map((b, i) => {
    const p = bucketStats(b.provisions);
    const u = bucketStats(b.unrests);
    return {
      bucket: i,
      ageStartCycles: i * FOUNDING_TRAJECTORY_BUCKET_CYCLES,
      ageEndCycles: (i + 1) * FOUNDING_TRAJECTORY_BUCKET_CYCLES - 1,
      n: b.provisions.length,
      meanProvision: p.mean,
      p10Provision: p.p10,
      meanUnrest: u.mean,
      p10Unrest: u.p10,
    };
  });
  return { buckets };
}

// ── Founding lifecycle: how long a founding takes, and what holds it up ──────────

/**
 * Running census of what held in-flight foundings back, in COLONY-CYCLES: one count per priced
 * colony per construction cycle, whether it moved or not, so every share below carries `observed`
 * as its denominator.
 *
 * The four gate counts partition `observed`. `stalled` and the two materials counts cut across them
 * and are deliberately NOT part of that partition:
 * - `stalled` is the world's own write-off clock, which advances on a money/materials stall and
 *   pointedly not on a pool-starved cycle;
 * - `materialsShort` is informational — a colony whose founder cannot spare the whole want still
 *   absorbs its full cap and opens thinner, so counting it as a stall would read a thinner endowment
 *   as a refused founding.
 */
export interface FoundingStallTotals {
  /** Colony-cycles observed — the denominator for every count here. */
  observed: number;
  /** Absorbed nothing: the charter is unpaid. */
  charter: number;
  /** Work held below the cap because the treasury could not buy the cycle's materials share. */
  funds: number;
  /** Materials would have allowed the work; the construction queue never reached the project. */
  pool: number;
  /** Nothing held the project below its cap. */
  unGated: number;
  /** Cycles that advanced the project's write-off counter. */
  stalled: number;
  /** Cycles whose founder could not spare the whole want (informational — work is not gated). */
  materialsShort: number;
  /** Of those, cycles whose founder was under an active event: accepted flavour, not a fault. */
  materialsShortUnderEvent: number;
}

export function newFoundingStallTotals(): FoundingStallTotals {
  return {
    observed: 0, charter: 0, funds: 0, pool: 0, unGated: 0,
    stalled: 0, materialsShort: 0, materialsShortUnderEvent: 0,
  };
}

/**
 * Fold one colony-cycle into the census. `founderUnderEvent` is the harness's own reading of whether
 * the source system was under an active event on that tick — the processor emits the shortfall, the
 * runner knows the event board, and the two only meet here.
 */
export function recordFoundingStall(
  totals: FoundingStallTotals,
  event: FoundingStallEvent,
  founderUnderEvent: boolean,
): void {
  totals.observed++;
  if (event.gate === null) totals.unGated++;
  else totals[event.gate]++;
  if (event.stalled) totals.stalled++;
  if (event.materialsShort) {
    totals.materialsShort++;
    if (founderUnderEvent) totals.materialsShortUnderEvent++;
  }
}

/** Running per-cycle census of open colony-establish projects — the settler gate's invariance to
 *  how long an establish takes is only visible as a concurrent count. */
export interface InFlightEstablishTotals {
  /** Cycles sampled — the mean's denominator. */
  samples: number;
  /** Σ open establishes across those samples. */
  total: number;
  max: number;
  maxTick: number | null;
}

export function newInFlightEstablishTotals(): InFlightEstablishTotals {
  return { samples: 0, total: 0, max: 0, maxTick: null };
}

/**
 * One pass over the open queue that does the two jobs needing it: census this cycle's in-flight
 * establishes, and record the first tick each colony was seen committed.
 *
 * The commitment reading is keyed by TARGET system and taken from the open queue rather than from a
 * processor signal, because the queue is where a commitment becomes real: an autonomic colony whose
 * charter cannot be paid is dropped and re-proposed with a fresh id, so nothing that could not pay
 * ever reaches this. A colony committed and completed inside a single cycle never appears at all —
 * `summarizeFoundingLifecycle` counts those rather than pretending they took zero cycles.
 */
export function sampleOpenColonies(
  projects: ReadonlyArray<Pick<WorldConstructionProject, "kind" | "systemId">>,
  tick: number,
  commitments: Map<string, number>,
  inFlight: InFlightEstablishTotals,
): void {
  let open = 0;
  for (const p of projects) {
    if (p.kind !== "colony_establish") continue;
    open++;
    if (!commitments.has(p.systemId)) commitments.set(p.systemId, tick);
  }
  inFlight.samples++;
  inFlight.total += open;
  if (open > inFlight.max) {
    inFlight.max = open;
    inFlight.maxTick = tick;
  }
}

/** How long foundings took, how many ran at once, and what held them up. */
export interface FoundingLifecycleSummary {
  /** Colonies founded in play whose commitment cycle was observed — the cycles denominator. */
  sampledCount: number;
  /** Founded colonies that never appeared in the open queue (committed and completed inside one
   *  cycle), so no duration exists for them. Excluded from the three figures below rather than
   *  folded in as zero, which would read as instant founding. */
  unobservedCount: number;
  meanCycles: number;
  medianCycles: number;
  maxCycles: number;
  inFlight: {
    meanPerCycle: number;
    max: number;
    maxTick: number | null;
    sampledCycles: number;
  };
  stalls: FoundingStallTotals;
}

/**
 * Fold the founding lifecycle into its reading. Durations are measured in CONSTRUCTION cycles —
 * `cycleTicks` is the interval this run resolved builds at, so a cadence override reports the same
 * unit rather than a tick count that silently means something else.
 */
export function summarizeFoundingLifecycle(
  tracker: ReadonlyMap<string, FoundedColonyRecord>,
  commitments: ReadonlyMap<string, number>,
  inFlight: InFlightEstablishTotals,
  stalls: FoundingStallTotals,
  cycleTicks: number,
): FoundingLifecycleSummary {
  const durations: number[] = [];
  let unobservedCount = 0;
  for (const r of tracker.values()) {
    const committedAt = commitments.get(r.systemId);
    if (committedAt === undefined) {
      unobservedCount++;
      continue;
    }
    const ticks = Math.max(0, r.foundedTick - committedAt);
    durations.push(cycleTicks > 0 ? ticks / cycleTicks : ticks);
  }
  let sum = 0;
  let max = 0;
  for (const d of durations) {
    sum += d;
    if (d > max) max = d;
  }
  return {
    sampledCount: durations.length,
    unobservedCount,
    meanCycles: durations.length > 0 ? sum / durations.length : 0,
    medianCycles: durations.length > 0 ? median(durations) : 0,
    maxCycles: max,
    inFlight: {
      meanPerCycle: inFlight.samples > 0 ? inFlight.total / inFlight.samples : 0,
      max: inFlight.max,
      maxTick: inFlight.maxTick,
      sampledCycles: inFlight.samples,
    },
    stalls,
  };
}

// ── Founder cohort: what supplying a colony costs the system that supplies it ────

/** The founder-cohort read for one cohort. Each cohort carries its own denominator. */
export interface FounderCohortStats {
  systemCount: number;
  /** Mean, per system, of its summed realized production rate — the selling side of the draw. */
  meanRealizedProduction: number;
  /** Share of PRODUCING markets flagged production-suppressed (strike or maintenance). */
  productionSuppressedShare: number;
  /** Producing markets in the cohort — the suppressed share's denominator. */
  producingMarkets: number;
  /** Mean building types per system sitting under a disuse countdown. */
  meanIdleTypes: number;
  /** Share of systems carrying any disuse countdown at all. */
  idleSystemShare: number;
}

/** One cohort's running sums while the two passes below walk systems and markets. */
interface CohortAccumulator {
  systemCount: number;
  production: number;
  producingMarkets: number;
  suppressed: number;
  idleTypes: number;
  idleSystems: number;
}

/**
 * Founder cohort vs the rest of the developed galaxy.
 *
 * Staging draws stock OUT of a founder, which is the `sellingFactor` side of the mechanic: a lower
 * start stock lifts the production ceiling, so a founder should read at least as productive and no
 * more idle than its neighbours. A founder cohort that produces less and idles more is the sustained
 * draw hollowing out the systems that pay for expansion — which no galaxy-wide average can show,
 * because founders are a minority of developed systems.
 *
 * Membership is a system that SUCCESSFULLY STAGED A DRAW, not one that sourced a founding: a founder
 * with nothing to spare supplies its colony no goods and so never enters the cohort at all. It is
 * also not random — such a system is by construction an established one with stock to spare, so it
 * out-produces the cohort of everything else (much of which is the colonies it founded) for reasons
 * that have nothing to do with founding. The comparison is read as a TREND between arms of the same
 * seed, never as a claim that supplying a colony made a system productive.
 */
export function summarizeFounderCohort(
  systems: ReadonlyArray<Pick<TickSystem, "id" | "control" | "buildingIdleCycles">>,
  markets: ReadonlyArray<Pick<WorldMarket, "systemId" | "realizedProductionRate" | "productionSuppressed">>,
  founderIds: ReadonlySet<string>,
): FounderCohortSummary {
  const developed = new Set<string>();
  for (const s of systems) {
    if (s.control === "developed") developed.add(s.id);
  }
  const acc = (): CohortAccumulator => ({
    systemCount: 0, production: 0, producingMarkets: 0, suppressed: 0, idleTypes: 0, idleSystems: 0,
  });
  const founder = acc();
  const other = acc();
  const bucketOf = (systemId: string): CohortAccumulator | undefined => {
    if (!developed.has(systemId)) return undefined;
    return founderIds.has(systemId) ? founder : other;
  };

  for (const s of systems) {
    const bucket = bucketOf(s.id);
    if (bucket === undefined) continue;
    bucket.systemCount++;
    let idle = 0;
    for (const cycles of Object.values(s.buildingIdleCycles)) {
      if (cycles > 0) idle++;
    }
    bucket.idleTypes += idle;
    if (idle > 0) bucket.idleSystems++;
  }
  for (const m of markets) {
    const bucket = bucketOf(m.systemId);
    if (bucket === undefined) continue;
    // A market only produces if it realized something. Missing means "not yet assessed", but an
    // ASSESSED non-producer holds a real 0 — and by run end that is nearly every row in the galaxy,
    // so testing for the field's presence would put the whole basket in the denominator and deflate
    // the suppressed share toward nothing.
    const realized = m.realizedProductionRate ?? 0;
    if (!(realized > 0)) continue;
    bucket.producingMarkets++;
    bucket.production += realized;
    if (m.productionSuppressed ?? false) bucket.suppressed++;
  }

  const fold = (b: CohortAccumulator): FounderCohortStats => ({
    systemCount: b.systemCount,
    meanRealizedProduction: b.systemCount > 0 ? b.production / b.systemCount : 0,
    productionSuppressedShare: b.producingMarkets > 0 ? b.suppressed / b.producingMarkets : 0,
    producingMarkets: b.producingMarkets,
    meanIdleTypes: b.systemCount > 0 ? b.idleTypes / b.systemCount : 0,
    idleSystemShare: b.systemCount > 0 ? b.idleSystems / b.systemCount : 0,
  });
  return { founder: fold(founder), other: fold(other) };
}

/** Founder cohort vs every other developed system, on the two reads the sustained draw moves. */
export interface FounderCohortSummary {
  founder: FounderCohortStats;
  other: FounderCohortStats;
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
    if (p.kind !== "build") continue; // colony-establish has no buildingType/levels; its lifecycle is reported separately, by sampleOpenColonies/summarizeFoundingLifecycle
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
