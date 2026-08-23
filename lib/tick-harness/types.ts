/**
 * Calibration-harness types — the config it takes, the results it returns, and
 * the market/event/region health shapes its analysers compute.
 *
 * The tick's own row types live in `lib/tick/rows.ts`; the one world model is
 * `World` (`lib/world/types.ts`) and the one tick pipeline is `runWorldTick`
 * (`lib/world/tick.ts`).
 */

import type { EventTypeId } from "@/lib/constants/events";
import type { GovernmentType } from "@/lib/types/game";
import type { TickCadence } from "@/lib/constants/tick-cadence";
import type { World } from "@/lib/world/types";
import type { DrawBrakeCeiling } from "@/lib/tick/processors/good-market-state";
import type { FoundingEraSummary, TreasurySnapshot, TreasurySummary } from "./treasury-analysis";
import type { FounderCohortSummary, FoundingLifecycleSummary, FoundingTrajectorySummary } from "./build-analysis";
import type { DemandHuntingSummary } from "./market-analysis";
import type { ConservationSummary } from "./conservation-analysis";
import type { QuantileLevels } from "./population-analysis";

// ── Market role classification ──────────────────────────────────

/** Which role a market (system × good) plays for that good. Mutually exclusive. The tuple is
 *  the single source for every roster iteration/validation, so a fifth role added to it grows
 *  the union and every consumer together. */
export const MARKET_ROLES = ["exporter", "self-supplier", "consumer", "inert"] as const;
export type MarketRole = (typeof MARKET_ROLES)[number];

// ── Calibration harness config ──────────────────────────────────

export interface HarnessConfig {
  systemCount: number;
  seed: number;
  tickCount: number;
  /** Optional per-run cycle-cadence override; absent ⇒ the live-loop constants. */
  cadence?: TickCadence;
  /**
   * Third-arm pin for the draw figure's brake ceiling (see `DrawBrakeCeiling`): `"anchor"` pins
   * the matcher's urgency gate to the retired anchor-based ceiling while the tick's own brake
   * stays live, so a stage-gate A/B can attribute the brake's direct effect and its
   * logistics-urgency ripple separately. Absent ⇒ `"live"`, the game's only behaviour.
   */
  drawBrakeCeiling?: DrawBrakeCeiling;
  /**
   * A baseline arm's role partition (`marketRoles` off its results), keyed `systemId|goodId`.
   * Supplied, this run's cover and price reads are cohorted against THAT membership instead of
   * its own — the role classifier reads the demand figure, so membership moves with any change
   * to it and a cover median then moves with the cohort mix rather than with supply. Absent ⇒
   * each market is classified live, as always.
   */
  pinnedRoles?: Record<string, MarketRole>;
}

// ── Market health ───────────────────────────────────────────────

export interface MarketSnapshot {
  systemId: string;
  goodId: string;
  stock: number;
  price: number;
}

export interface PriceLevelSummary {
  /** Median price / basePrice across all markets (galaxy-wide). */
  median: number;
  /** 10th percentile price / basePrice. */
  p10: number;
  /** 90th percentile price / basePrice. */
  p90: number;
  /** Fraction of markets below 0.9× base (cheap — overstocked). */
  cheapFrac: number;
  /** Fraction within 0.9–1.1× base (near the anchor). */
  nearFrac: number;
  /** Fraction above 1.1× base (expensive — scarce). */
  expensiveFrac: number;
}

export interface CoverLevelEntry {
  goodId: string;
  /** Median stock / price anchor (cycles-of-supply cover, the pricing reading) across systems. */
  medianCover: number;
  /** Fraction of markets at/above the ordinary-donor line (donor reserve × surplus margin,
   *  demand-denominated) — holders of a standing drawable excess. */
  surplusFrac: number;
  /** Fraction below the logistics deficit line (warehousing target × deficit fraction,
   *  demand-denominated). */
  deficitFrac: number;
}

/** Roles that hold stock — `inert` is excluded: a median cover over pricing-artifact markets means nothing. */
export type StockedRole = Exclude<MarketRole, "inert">;

/**
 * Which knee term set each producing market's brake geometry — the evidence
 * `BRAKE_OUTPUT_COVER` is tuned on. Counts, not fractions: the two columns sum to the good's
 * producing-market count (the instrument's self-check), recorded at the knee, never inferred
 * from post-taper behaviour.
 */
export interface KneeBindingEntry {
  goodId: string;
  use: number;
  output: number;
}

/** One good's cover and price, split by the role each of its markets plays. */
export interface RoleCoverEntry {
  goodId: string;
  /** Market count in each role, including inert. */
  countByRole: Record<MarketRole, number>;
  /** Median stock / targetStock per role. 0 for a role with no markets. */
  medianCoverByRole: Record<StockedRole, number>;
  /** Of `countByRole.inert`, the subset whose local demand is genuinely 0 rather than merely
   *  floored below MIN_DEMAND — a small world can have real demand that still lands as inert. */
  trulyInertCount: number;
  /** Share of consumer markets sitting at the stock floor — literally empty, not merely low. */
  consumerEmptyFrac: number;
  /** Median price / basePrice across exporter markets — the resting-price read. */
  exporterMedianPriceRatio: number;
}

// ── World cohorts ───────────────────────────────────────────────

/**
 * A settled system's cohorts. The groupings are independent views, not one partition: a system
 * lands in exactly one population band, exactly one of homeworld/colony, exactly one of
 * single-/multi-people-land-body (a COLONISABLE system always carries at least one contributing
 * body, so this pair is exhaustive over the same membership `survival-short` and the population
 * bands are drawn from), plus `survival-short` if it is colonisable and cannot feed itself. Rows
 * therefore overlap by design and each carries its own denominator.
 */
export type WorldCohort =
  | "pop <10" | "pop 10-100" | "pop 100-1K" | "pop >=1K"
  | "survival-short" | "homeworld" | "colony"
  | "quality: single-body" | "quality: multi-body";

/** One cohort's supply and unrest reading. Cohorts overlap — see cohortsForSystem. */
export interface WorldCohortEntry {
  cohort: WorldCohort;
  /** Settled systems in this cohort — this row's own denominator. */
  n: number;
  /** Mean shortfall (1 − Provision, dissatisfaction()'s linear scale) over the cohort's systems. */
  meanShortfall: number;
  meanUnrest: number;
  strikingShare: number;
  suppliedShare: number;
  strainedShare: number;
  rationingShare: number;
  deprivedShare: number;
  famineShare: number;
  /** Mean provision() over the cohort's systems. */
  meanProvision: number;
  /** Median of each system's single worst-demanded-good satisfaction (1 for a system with no
   *  demanded goods) — the quantile a mean would flatten out of a bimodal cohort. */
  worstGoodMedian: number;
  /**
   * (end population − start population) / start population, summed over the cohort before
   * dividing (never averaged per system) so a system absent from the tick-0 population reading —
   * a colony founded during the run — contributes its whole end population to the numerator
   * instead of an individual divide-by-zero. Membership is END-of-run: a system is scored in the
   * cohort it FINISHED in, not the one (if any) it started in, so a cohort's growth includes
   * colonies founded into it mid-run and excludes ones it grew out of by crossing a population
   * band. Net growth moves with the crowd brake, migration and founding rate, not only the growth
   * factor — read this alongside those, never as a clean read on the growth factor alone. 0 when
   * the cohort's own start-population sum is 0 (matches `growthPct`'s zero-start convention). Null
   * when the run took no tick-0 population reading at all (`startPopulationBySystem` empty) —
   * unmeasured, not a lying 0.
   */
  netGrowthPct: number | null;
  /** Distribution of the stored adaptive-expectation memory over the cohort's NON-STALE systems
   *  (see `staleExpectationCount`) — median/p10/p90/n printed alongside the galaxy-wide reading
   *  (`SupplyRegimeSummary.expectationLevels`) so a cohort's memory can be read apart from the mean. */
  expectationLevels: QuantileLevels;
  /** Distribution of grievance (the same read the unrest fold makes) over the same non-stale
   *  systems as `expectationLevels`. */
  grievanceLevels: QuantileLevels;
  /** Cohort systems excluded from `expectationLevels`/`grievanceLevels` because their basket was
   *  empty at read time — see `SupplyRegimeSummary.staleExpectationCount` for why folding these in
   *  would read stale memory as current. */
  staleExpectationCount: number;
  /** Distribution of the cached fill-best-first habitability quality (`s.habitabilityQuality.
   *  quality`, `lib/engine/habitability.ts`) over the cohort's systems that carry a reading —
   *  target 5's live read, most meaningful on the `quality: single-body` / `quality: multi-body`
   *  cohorts (the fold's live audience) but reported for every cohort on the same basis as
   *  `expectationLevels`. A system never assessed (no cached reading — should not occur for a
   *  colonisable, settled system past its first cycle) is excluded, not folded in as 0. */
  qualityLevels: QuantileLevels;
  /** Cohort systems excluded from `qualityLevels` for carrying no cached `habitabilityQuality`
   *  reading at all. */
  qualityUnassessedCount: number;
  /** Σ colonist-delivery inflow (`TickInstrumentation.colonistDeliveryBySystem`, accumulated across
   *  the whole run) over the cohort's systems — the pump-watch numerator. Always >= 0: delivery is
   *  the positive (sink) side only, never a source's outflow. */
  colonistDeliveryInflow: number;
  /** (end population − start population), summed over the cohort — the pump-watch's OTHER side, in
   *  the same absolute units as `colonistDeliveryInflow` so the two can be read against each other
   *  directly (unlike `netGrowthPct`, which is a percentage and cannot be compared to an inflow
   *  count). A cohort can show `colonistDeliveryInflow > 0` alongside `netPopulationChange < 0` —
   *  water-fill pushing people in while decline/death/leak still nets the cohort down — and that
   *  disagreement is exactly the signature the pump watch exists to catch. Same null convention as
   *  `netGrowthPct`: null when no tick-0 reading was taken at all, never a lying 0. */
  netPopulationChange: number | null;
}

// ── Episode costs ────────────────────────────────────────────────
//
// A grievance episode's cost is real and irreversible (teardown, overshoot death) —
// docs/active/gameplay/economy.md, unrest promise 5. Accumulated per-cycle from `TickInstrumentation`
// (`population-analysis.ts`'s `EpisodeCostTotals`), folded here by world cohort.

/** One cohort's cumulative episode costs over the whole run. */
export interface EpisodeCostCohortEntry {
  cohort: WorldCohort;
  /** Cohort systems — this row's own denominator (matches `WorldCohortEntry.n`). */
  n: number;
  /** Σ whole building levels torn down across the run, over the cohort's systems. */
  teardownLevels: number;
  /** Distinct cohort systems that lost at least one level — incidence, not magnitude. */
  systemsWithTeardown: number;
  /** Σ overshoot-death amount across the run, over the cohort's systems. */
  overshootDeaths: number;
  /** Distinct cohort systems that incurred any overshoot death. */
  systemsWithOvershootDeath: number;
}

export interface EpisodeCostSummary {
  /** Galaxy-wide totals — the sum over every system that ever recorded a cost during the run,
   *  whatever cohort it falls in at run end (cohorts overlap, so this is NOT the sum of
   *  `byCohort`'s rows). Unfiltered by end-of-run settlement — today nothing un-develops a
   *  system, so in practice every recorded system is still settled, but the total does not
   *  itself re-check that. */
  totalTeardownLevels: number;
  totalOvershootDeaths: number;
  byCohort: EpisodeCostCohortEntry[];
}

// ── The ratchet check ───────────────────────────────────────────
//
// The memory's known hazard on a jittering input is a rectifier — an asymmetric filter fed an
// oscillation tracks its peaks, so mean-preserving jitter would read as permanent grievance. This buckets settled systems by their trailing
// Provision variance (`population-analysis.ts`'s `computeTrailingProvisionVariance`) and reads mean
// grievance per bucket, per cohort: a positive slope (higher variance ⇒ higher mean grievance at
// comparable Provision) is the rectifier firing.

/** One (cohort, variance-quartile) cell. Bucket 0 is the cohort's calmest quartile by trailing
 *  Provision variance, bucket 3 its jitteriest — quartiles are computed WITHIN the cohort, not
 *  against a fixed variance scale, so the bucketing is comparable across arms whatever their
 *  absolute variance level. */
export interface RatchetBucketEntry {
  cohort: WorldCohort;
  /** 0 (calmest quartile) .. 3 (jitteriest). */
  bucket: number;
  /** Systems in this cell — only systems with enough trailing samples to carry a variance reading
   *  are bucketed at all (see `RATCHET_MIN_SAMPLES`), so this can be smaller than a quartile's
   *  nominal share. */
  n: number;
  meanVariance: number;
  meanGrievance: number;
}

export interface RatchetCheckSummary {
  window: number;
  buckets: RatchetBucketEntry[];
}

// ── Abandonment by cause ────────────────────────────────────────
//
// Abandonment Rule 2 (`ABANDON_POP_FLOOR`, `lib/tick/processors/population.ts`) fires on
// below-floor population alone since Task 8 — famine or not. `TickProcessorResult.
// abandonedSystemsByCause` tags each finding with whether that system's supply state carried
// `survivalShortfall` this cycle, so the two paths (famine-driven collapse vs a marginal-land
// system declining to empty under non-famine stress) stay distinguishable in the aggregate.

/** Whole-run counts, accumulated from every cycle's `abandonedSystemsByCause`. `total` is
 *  `famineCollapse + declineToEmpty` — the identity this type exists to make checkable is proven
 *  upstream, at the processor unit (`runPopulationProcessor`'s own tests): every system pushed to
 *  `abandonedSystems` gets exactly one entry in `abandonedSystemsByCause`, from the same loop
 *  iteration, so there is no third path this harness-level sum could silently drop. */
export interface AbandonmentCauseSummary {
  famineCollapse: number;
  declineToEmpty: number;
  total: number;
}

export interface MarketHealthSummary {
  /** Per-good average price standard deviation across systems (high = trade opportunity). */
  priceDispersion: { goodId: string; avgStdDev: number }[];
  /** Per-good average distance of stock from its targetStock at simulation end. */
  stockDrift: { goodId: string; avgStockDrift: number }[];
  /** Per-good fraction of markets clamped at the stock floor / ceiling (supply pathology surface). */
  stockPins: { goodId: string; floorFrac: number; ceilingFrac: number }[];
  /** Galaxy-wide price/base distribution — the floor-pinning signal. */
  priceLevels: PriceLevelSummary;
  /** Per-good stock cover distribution (stock/anchor) — surplus/deficit balance. */
  coverLevels: CoverLevelEntry[];
}

// ── Event impact ────────────────────────────────────────────────

/** Price snapshot for a single good at event boundary. */
export interface EventBoundaryPrice {
  goodId: string;
  price: number;
}

/** Lifecycle record for an event (tracked during simulation). */
export interface EventLifecycle {
  id: string;
  type: EventTypeId;
  /** Null for region/pair-level events (e.g. relations-owned events). */
  systemId: string | null;
  severity: number;
  startTick: number;
  endTick: number;
  sourceEventId: string | null;
  /** Prices at the event's system when the event started ([] if systemId is null). */
  startPrices: EventBoundaryPrice[];
  /** Prices at the event's system when the event ended ([] if systemId is null). */
  endPrices: EventBoundaryPrice[];
}

/** Per-good price change during an event. */
export interface GoodPriceChange {
  goodId: string;
  priceBefore: number;
  priceAfter: number;
  changePct: number;
}

export interface EventImpact {
  eventId: string;
  eventType: string;
  systemId: string | null;
  systemName: string;
  severity: number;
  startTick: number;
  endTick: number;
  duration: number;
  /** null for root events, event type string for child/spread events. */
  parentEventType: string | null;
  /** Per-good price changes between event start and end. */
  goodPriceChanges: GoodPriceChange[];
  /** Base-price-weighted average price change across all goods (%). */
  weightedPriceImpactPct: number;
}

// ── Logistics activity ──────────────────────────────────────────

/** One good's logistics totals across the run. */
export interface LogisticsGoodActivity {
  goodId: string;
  transferCount: number;
  quantity: number;
}

/**
 * Whole-run directed-logistics activity. Accumulated per tick rather than read
 * off the final world: `world.flowEvents` only retains a rolling window
 * (`TRADE_SIMULATION.FLOW_HISTORY_TICKS`).
 */
export interface LogisticsActivitySummary {
  /** Flow events recorded across the whole run. 0 in a populated galaxy means the matcher never fired. */
  transferCount: number;
  /** Ticks carrying at least one transfer — logistics resolves on the cycle start, so a healthy run is rhythmic. */
  activeTicks: number;
  /** Total quantity moved across the run. */
  totalQuantity: number;
  /** totalQuantity / transferCount — the magnitude canary. 0 when nothing moved. */
  meanTransferSize: number;
  /** Distinct systems that sent or received at least once. */
  participatingSystems: number;
  /** Per-good totals, heaviest first. A good that never moved is absent. */
  byGood: LogisticsGoodActivity[];
  /** Haul-budget spend fraction: Σ spent / Σ granted, accumulated from `LOGISTICS_WARMUP_TICKS`
   *  onward (earlier cycles grant budget nothing can spend, which would dilute the denominator).
   *  Near 1 means the money brake binds; the attribution run measured 6–8% single-donor — at the
   *  pre-raise `GENERATION_PER_POP` (0.5), so reproducing that anchor needs the constant pinned
   *  back too. */
  budgetSpentFrac: number;
  /** Deficits recorded funding-bound from `LOGISTICS_WARMUP_TICKS` onward (events, not markets —
   *  a market recurring every cycle counts every time). */
  fundingBoundEvents: number;
  /** Developed-system markets carrying the funding-bound flag at run end — the census numerator.
   *  Exposed raw so a zero rate is checkable against a live census (marketCount > 0). */
  fundingBoundFlaggedMarkets: number;
  /** Developed-system markets in the census at run end — the denominator. 0 here with a
   *  populated galaxy means the census itself is broken, not that funding never bound. */
  fundingBoundMarketCount: number;
  /** Fraction of developed-system markets carrying the funding-bound flag at run end —
   *  the gameplay blast radius (planner suppression + idle-decay exemption). */
  fundingBoundFlagSetRate: number;
  /** transferCount / activeTicks — flow-log rows per resolving cycle, the row-volume canary
   *  for the multi-donor fan-out (one row per donor-draw). 0 when nothing moved. */
  flowRowsPerCycle: number;
}

// ── Construction burst pacing ───────────────────────────────────

/** One good's worst-case single-cycle directed-build commitment across a run. */
export interface BuildBurstEntry {
  goodId: string;
  /** The largest count of new autonomic levels this good was ever committed in one cycle. */
  maxLevelsPerCycle: number;
  /** The tick at which that maximum occurred. */
  tick: number;
}

/**
 * Whole-run directed-build burst pacing — the instrument proving the construction rate cap
 * (`DIRECTED_BUILD.BUILD_RATE_CAP`) actually bounds per-cycle proposal velocity. Aggregate market/
 * queue health can look fine while one good's new-proposal levels spike in a single cycle (a
 * planner burst rather than a smooth ramp); this measures that spike directly, per good and
 * galaxy-wide, rather than reading it off the final world (the burst is gone by then — only the
 * queue's end state survives).
 */
export interface BuildBurstSummary {
  /** Per-good worst-case burst, descending by maxLevelsPerCycle (goodId ascending breaks ties). */
  byGood: BuildBurstEntry[];
  /** The single worst burst across every good this run — the headline number. 0 when nothing was committed. */
  globalMax: number;
  /** The good behind globalMax; null when the run committed nothing. */
  worstGood: string | null;
  /** The tick at which globalMax occurred; null when the run committed nothing. */
  worstTick: number | null;
}

// ── Migration throughput ─────────────────────────────────────────

/**
 * Whole-run migration throughput — people actually moved (conserved transfers only: colonist
 * delivery + edge diffusion, never growth/death terms). Reads most meaningfully on a land-tight
 * seed, where colony housing is sized to the seed's own need with no spare level and growth must
 * lean on the crowd brake + migration push instead of housing absorbing it directly; on a
 * generous-headroom seed, low throughput here does not mean the push is broken — housing is doing
 * the absorbing.
 */
export interface MigrationThroughputSummary {
  /** Total people delivered by targeted colonist delivery across the run. */
  totalColonists: number;
  /** Total people moved by edge diffusion across the run. */
  totalDiffusion: number;
  /** Cycle starts that resolved migration — the per-cycle mean's denominator. */
  cycleCount: number;
  /** (totalColonists + totalDiffusion) / cycleCount; 0 when cycleCount is 0 (never NaN). */
  meanPerCycle: number;
}

// ── Strike suppression ───────────────────────────────────────────

/**
 * Whole-run directed-build proposals `strikeExplains` suppressed, resolved per (system, good) pair
 * over every cycle's assessment. `eligible` is every pair a strike could ever silence (capacity in
 * the good); `suppressed` is the subset where it did. Read `ratePerEligible`, never the raw counts —
 * the raw count grows with the galaxy (hazard-6: 582 settled systems at equilibrium against 253 at
 * startup), so only the rate is comparable across horizons or arms.
 */
export interface StrikeSuppressionSummary {
  /** (system, good) pairs across the run with capacity in the good — the pool a strike can silence. */
  eligible: number;
  /** The subset of `eligible` where `strikeExplains` actually silenced the feedback-gap term. */
  suppressed: number;
  /** suppressed / eligible; 0 when eligible is 0 (never NaN) — a run with no construction cycle due,
   *  or a galaxy with no capacity anywhere, reads a zero denominator rather than dividing by it. */
  ratePerEligible: number;
}

// ── Colony founding stock ───────────────────────────────────────

/**
 * How well fed colonies founded during the run were at their first assessed cycle. A colony used to
 * open holding nothing on every good; the founding-stock endowment ships it a slice of its founder's
 * warehouses. Measured at founding because a handful of new systems cannot move any galaxy-wide
 * average — `medianCover` medians over every market and would read green through this entirely.
 */
export interface FoundingStockSummary {
  /** Systems that became `developed` after tick 0 — colonies founded in play. */
  foundedCount: number;
  /** Those that reached their first post-founding economy cycle before the run ended. */
  sampledCount: number;
  /** Mean, over sampled colonies, of DEMAND-WEIGHTED satisfaction at that cycle — a good counts for
   *  what the colony actually needs of it, so no water weighs far heavier than no reactor cores.
   *  Should sit near 1; near 0 is a colony arriving genuinely unprovisioned. */
  meanOpeningSatisfaction: number;
  /** Mean, over sampled colonies, of the `dissatisfaction` fold (1 − Provision, linear scale) the
   *  unrest engine itself reads. Reported alongside the weighted mean so the instrument and the
   *  simulation cannot drift into disagreeing about whether a colony opened deprived. */
  meanOpeningShortfall: number;
  /** Mean, over sampled colonies, of `provision()` (necessity-and-demand-weighted mean satisfaction)
   *  at the same cycle and over the same basket as `meanOpeningSatisfaction` — a good's weight is
   *  demand × necessity here, demand alone there, so the two read apart whenever a colony's worst
   *  shortage and its most-needed good disagree. This is THE MEASURED founding Provision the founding
   *  invariant's shortfall term is written against. Null when no colony was ever founded or none
   *  reached a first assessment — a mean of nothing must not print as "opened at 0% Provision". */
  meanOpeningProvision: number | null;
  /** The 10th percentile of the same per-colony Provision readings behind `meanOpeningProvision`.
   *  Reported alongside the mean because the founding invariant does not say whether "the measured
   *  founding Provision" means the cohort's average or its worst decile — both exist so that choice
   *  can be made from real numbers. Null under the same rule as the mean. */
  p10OpeningProvision: number | null;
  /** The literal minimum of the same per-colony Provision readings behind `meanOpeningProvision` —
   *  NOT derived from `p10OpeningProvision` (a percentile bounds only 90% of the cohort; the tail
   *  below it can sit arbitrarily far under the p10 mark). Promise 1's window promise is structural
   *  down to p10, but the sub-p10 tail is bounded only by this measured minimum, which the gate
   *  reads directly. Null under the same rule as the mean and p10. */
  minOpeningProvision: number | null;
  /** Sampled colonies that opened below half satisfaction. Should read ~0. */
  openingDeprivedCount: number;
  /** Mean tonnage staged per colony founded — what founding costs a founder in goods. The
   *  manifest's cap is use-figure denominated, so this moves when a founder's stated draw does. */
  meanManifestTonnage: number;
  /** Mean money per colony founded paid for those staged materials, through the founding valuation
   *  seam. The charter fee is a separate charge and is not in it. */
  meanFoundingMoneyCost: number;
  /** Median, over colonies with a measurable cover reading, of the founder's own remaining cover on
   *  the binding good — the deepest any one of that colony's staging draws left it (post-draw stock
   *  ÷ that good's donor floor, minimum across draws). Below 1 means founding is drawing founders
   *  under the floor they are meant to keep. Null when no founding produced a measurable reading —
   *  the median of nothing must not print as a founder drained to 0.00×.
   *
   *  Not comparable with a run measured before materials were staged per cycle, where the same name
   *  meant one whole manifest taken in a single draw. Nor is it a clean per-colony attribution: a
   *  draw is measured against what the founder holds after every draw already made on it that cycle,
   *  including other colonies', so a colony the queue reaches second reads deeper than the same
   *  colony would have read first. */
  medianFounderCoverAfter: number | null;
  /** Share of the run's founded colonies the cadence mark below is taken at. Reported so the mark is
   *  never read against a differently-defined one. */
  cadenceMarkShare: number;
  /** The tick by which that share of the run's colonies had been founded — how far the founding
   *  burst spread, which the founded count alone cannot show. Null when nothing was founded. */
  cadenceMarkTick: number | null;
}

// ── Region overview ─────────────────────────────────────────────

export interface RegionOverviewEntry {
  name: string;
  /** Modal government type across the region's systems, derived from faction ownership. */
  dominantGovernmentType: GovernmentType;
  systemCount: number;
}

// ── Results ─────────────────────────────────────────────────────

export interface HarnessResults {
  config: HarnessConfig;
  /**
   * The economy scale the run actually resolved at. Not a `HarnessConfig` input —
   * it is an ambient module constant read from the environment at import, so the
   * run reports it rather than setting it.
   */
  economyScale: number;
  /** Market state sampled at regular intervals. */
  marketSnapshots: { tick: number; markets: MarketSnapshot[] }[];
  /** Derived market health metrics. */
  marketHealth: MarketHealthSummary;
  /** Per-good cover and price split by market role. */
  roleCoverLevels: RoleCoverEntry[];
  /** Per good, which knee term bound each producing market at run end — the brake's geometry census. */
  kneeBinding: KneeBindingEntry[];
  /**
   * The role this run classified each market into, keyed `systemId|goodId` — the partition a
   * later arm pins to via `HarnessConfig.pinnedRoles`. Always the LIVE classification, even on a
   * pinned run: echoing back the pin would hide exactly the membership drift the pin exists to
   * measure. A plain record, not a Map, because results are saved as JSON.
   */
  marketRoles: Record<string, MarketRole>;
  /** Whether the network is chasing a demand signal that moves under it — deficit↔surplus
   *  reversals on industrial-input markets, and delivered tonnage that leaves again. */
  demandHunting: DemandHuntingSummary;
  /** Supply and unrest per world cohort. Cohorts overlap; each row carries its own denominator. */
  worldCohorts: WorldCohortEntry[];
  /** Whole-run abandonment counts split by cause — famine-collapse (Rule 1's crisis term drove the
   *  decline) vs decline-to-empty (Task 8's dropped famine conjunct: a marginal-land system that
   *  never cleared unrest, no famine involved). */
  abandonmentByCause: AbandonmentCauseSummary;
  /** Impact measurement for each event that occurred. */
  eventImpacts: EventImpact[];
  /** Whole-run directed-logistics activity — did goods actually move. */
  logisticsActivity: LogisticsActivitySummary;
  /** Whole-run directed-build burst pacing — the construction rate cap's per-cycle worst case. */
  buildBurstSummary: BuildBurstSummary;
  /** Region overview for understanding the generated universe. */
  regionOverview: RegionOverviewEntry[];
  /** Optional label for experiment tracking. */
  label?: string;
  /** Total wall-clock time in ms. */
  elapsedMs: number;
  /** Final world state after all ticks (for post-run analysis). */
  finalWorld: World;
  /** Total population summed across all systems at tick 0 (before the loop). */
  initialPopulationTotal: number;
  /** Total building count summed across all systems at tick 0 (before the loop). */
  initialBuildingTotal: number;
  /** Population snapshots sampled at SNAPSHOT_INTERVAL ticks (parallel to marketSnapshots). */
  populationSnapshots: Array<Map<string, number>>;
  /** Whole-run migration throughput — conserved people-moved totals, colonist delivery vs edge diffusion. */
  migrationThroughput: MigrationThroughputSummary;
  /** Whole-run directed-build proposals `strikeExplains` suppressed, per eligible (system, good) pair. */
  strikeSuppression: StrikeSuppressionSummary;
  /** How well provisioned colonies founded during the run were at their first assessed cycle. */
  foundingStock: FoundingStockSummary;
  /** How long foundings took, how many ran at once, and what held them up — the reading that tells a
   *  founding the money gate refused from one the construction pool never reached. */
  foundingLifecycle: FoundingLifecycleSummary;
  /** The systems that successfully staged a founding draw, read against every other developed system. */
  founderCohort: FounderCohortSummary;
  /** Faction-treasury health at simulation end — balances, income mix, funded fractions, shortfalls. */
  treasurySummary: TreasurySummary;
  /** The founding-era money bars, counted over settled faction-cycles across the whole run. */
  foundingEra: FoundingEraSummary;
  /** Treasury balance trajectory sampled at SNAPSHOT_INTERVAL ticks (parallel to marketSnapshots). */
  treasurySnapshots: TreasurySnapshot[];
  /** The four pass/fail conservation identities — the half of the acceptance bar that is checked
   *  rather than judged. */
  conservation: ConservationSummary;
  /** Cumulative teardown + overshoot death over the whole run, galaxy-wide and by cohort — an
   *  episode's cost is real and irreversible (promise 5). */
  episodeCosts: EpisodeCostSummary;
  /** Founding-cohort Provision and unrest trajectory over colony age (promise 1's window half) —
   *  builds on `foundingStock`'s opening-only snapshot with repeated readings per colony. */
  foundingTrajectory: FoundingTrajectorySummary;
  /** The ratchet check: settled systems bucketed by trailing Provision variance, mean grievance per
   *  bucket per cohort — a positive slope is the memory rectifying jitter into permanent grievance. */
  provisionRatchet: RatchetCheckSummary;
}
