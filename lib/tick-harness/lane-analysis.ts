/**
 * Lane-mechanics analysis for the calibration harness (spec §7): whole-run lane utilisation,
 * congestion, blocked volume, foreign-transit share, per-faction contention and survival-stock
 * census. Sampled per logistics-boundary tick from `world.lanes` and the freshly-dispatched
 * pendingArrival ledger rows, folded here rather than read off the final world — `lane.bookedLoad`
 * and `.blockedVolume` are OVERWRITTEN every logistics cycle (an attempted-load snapshot, not a
 * running total: docs/active/gameplay/logistics-lanes.md §1), so a whole-run reading has to be accumulated
 * as each cycle happens, the same reason `logistics-analysis.ts` accumulates the flow log per tick
 * rather than reading `world.flowEvents` at the end.
 *
 * Every per-tick/per-cycle fold in this module is gated by the caller to `LOGISTICS_WARMUP_TICKS`
 * onward (`logistics-analysis.ts`'s own equilibrium convention) — directed-logistics moves nothing
 * before colonisation seeds it, so an unwindowed read would report a founding-era galaxy as the
 * whole run's lane health.
 */
import { laneCapacity } from "@/lib/engine/lanes";
import { currentHopIndex } from "@/lib/engine/freight";
import { survivalCyclesToEmpty, SURVIVAL_STOCK_CYCLES_THRESHOLD } from "@/lib/engine/survival-stock";
import { SURVIVAL_GOODS } from "@/lib/constants/physical-economy";
import { DIRECTED_LOGISTICS } from "@/lib/constants/directed-logistics";
import { ECONOMY_CONSTANTS, ECONOMY_SIM_PARAMS } from "@/lib/constants/economy";
import { brakeKnee } from "@/lib/engine/tick";
import { surplusDrawable } from "@/lib/engine/directed-logistics";
import type { LogisticsBlockedEntry } from "@/lib/engine/lane-routing";
import { median, quantile } from "@/lib/utils/math";
import type { WorldConstructionProject, WorldLane, WorldMarket, WorldPendingArrival } from "@/lib/world/types";
import type { LogisticsTargetInfo, MarketRoleInfo } from "./cohort-analysis";
import type { FundingBoundIncidenceEntry } from "./logistics-analysis";
import { MARKET_ROLES, type MarketRole } from "./types";

/** Ticks (10 cycles) the re-measure metric and its guards read back from the horizon — the same
 *  window `temp/depot-diag.ts`'s Claim-1 instrument used. */
const INBOUND_LATENCY_WINDOW_TICKS = 240;

// ── Accumulator ───────────────────────────────────────────────────

interface PerLane {
  bookedSum: number;
  blockedSum: number;
  utilSum: number;
  utilCount: number;
  /** Running sum of quantity sampled PHYSICALLY crossing this lane, one sample per tick
   *  (`sampleLaneOccupancy`) — the harness-side reading of what the lane card's `inFlight` shows at
   *  any one instant, accumulated across the run the same way `bookedSum`/`blockedSum` are. */
  inTransitSum: number;
}

/** One outbound dispatch row retained for the re-measure metric — the fields `temp/depot-diag.ts`'s
 *  Claim-1 instrument folded per sink, kept only for rows landing in the ten cycles before the
 *  horizon (`sampleLaneDispatch`'s window test). */
export interface DispatchSample {
  dispatchTick: number;
  arrivalTick: number;
  toSystemId: string;
  goodId: string;
  quantity: number;
}

export interface LaneRunAccumulator {
  /** Every utilisation-ratio sample (one per lane with capacity > 0, per sampled boundary tick) —
   *  the flat population `utilisation`'s percentiles read over. */
  utilSamples: number[];
  saturatedSamples: number;
  perLane: Map<string, PerLane>;
  /** Per-tick Σ outbound pendingArrival quantity — `inTransitVolume`'s mean/max population. */
  inTransitSamples: number[];
  foreignDispatchQty: number;
  totalDispatchQty: number;
  contentionShortfallByFaction: Map<string | null, number>;
  overshootVolumeTotal: number;
  budgetSkippedTotal: number;
  /** This run's horizon (`HarnessConfig.tickCount`), fixed at creation — `sampleLaneDispatch`'s
   *  window test reads it. A run that never supplies one (an isolated fold in a test) keeps every
   *  real `arrivalTick` outside the window, so `dispatchSamples` stays empty rather than silently
   *  admitting rows it was never asked to window. */
  tickCount: number;
  /** Outbound rows whose `arrivalTick` fell in the ten cycles before `tickCount` — `inboundLatency`'s
   *  whole population. */
  dispatchSamples: DispatchSample[];
  /** Σ logistics work billed (`PlannedTransfer.cost` route-cost units, never money), gated to
   *  `LOGISTICS_WARMUP_TICKS` the same as every other lane-mechanics fold — `logisticsWorkPerDeliveredUnit`'s
   *  numerator. */
  totalWork: number;
  /** Σ quantity credited by arrivals over the same gated window — `logisticsWorkPerDeliveredUnit`'s
   *  denominator. */
  totalDeliveredQty: number;
  /** The first logistics run whose freshly-released supplier/idle stock summed above 0 across the
   *  galaxy — set once and never overwritten; `null` while no run has crossed it. */
  releasedFirst: { tick: number; totalsByGood: Map<string, number> } | null;
}

export function newLaneRunAccumulator(tickCount = Number.MAX_SAFE_INTEGER): LaneRunAccumulator {
  return {
    utilSamples: [],
    saturatedSamples: 0,
    perLane: new Map(),
    inTransitSamples: [],
    foreignDispatchQty: 0,
    totalDispatchQty: 0,
    contentionShortfallByFaction: new Map(),
    overshootVolumeTotal: 0,
    budgetSkippedTotal: 0,
    tickCount,
    dispatchSamples: [],
    totalWork: 0,
    totalDeliveredQty: 0,
    releasedFirst: null,
  };
}

/** Fold one cycle's billed logistics work (Σ `PlannedTransfer.cost` over every faction this
 *  cycle) — the caller gates this to `LOGISTICS_WARMUP_TICKS`, same as the rest of this module's
 *  per-tick folds. */
export function recordLogisticsWork(acc: LaneRunAccumulator, work: number): void {
  acc.totalWork += work;
}

/** Fold one tick's arrivals-credited quantity (`TickInstrumentation.goodsArrivals.appliedCreditTotal`)
 *  — same gate as `recordLogisticsWork`, so the two totals answer the same window's question. */
export function recordDeliveredQuantity(acc: LaneRunAccumulator, quantity: number): void {
  acc.totalDeliveredQty += quantity;
}

/** Fold one logistics run's freshly-released tonnage by good — the drawable that a supplier/idle
 *  market's own give line uncovers beyond what a full-rate consumer would have kept
 *  (`consumerDeepLine`). A no-op once the first positive run has already been recorded: the read
 *  is "the first cycle", not a running total. */
export function sampleReleasedTonnage(
  acc: LaneRunAccumulator,
  tick: number,
  releasedByGood: ReadonlyMap<string, number>,
): void {
  if (acc.releasedFirst) return;
  let total = 0;
  for (const v of releasedByGood.values()) total += v;
  if (total > 0) acc.releasedFirst = { tick, totalsByGood: new Map(releasedByGood) };
}

function perLaneEntry(acc: LaneRunAccumulator, key: string): PerLane {
  let entry = acc.perLane.get(key);
  if (!entry) {
    entry = { bookedSum: 0, blockedSum: 0, utilSum: 0, utilCount: 0, inTransitSum: 0 };
    acc.perLane.set(key, entry);
  }
  return entry;
}

/**
 * First-release transient (spec §6): the drawable a supplier/idle market's own give line uncovers
 * beyond what a full-rate consumer would still be holding (`consumerDeepLine`) — the stock that
 * became drawable ONLY because this market's role stopped being "consumer", not stock any role
 * would have released anyway. A consumer market contributes nothing here (filtered before either
 * `surplusDrawable` call), so a run with no role change reads every good at 0.
 */
export function computeReleasedByGood(
  targetsByKey: ReadonlyMap<string, LogisticsTargetInfo>,
  marketByKey: ReadonlyMap<string, Pick<WorldMarket, "goodId" | "stock">>,
): Map<string, number> {
  const releasedByGood = new Map<string, number>();
  for (const [key, info] of targetsByKey) {
    if (info.role !== "supplier" && info.role !== "idle") continue;
    const market = marketByKey.get(key);
    if (!market) continue;
    const releasedNow = surplusDrawable(
      market.stock, info.donorReserve, info.marginFree, info.demand, info.production,
      info.productionSuppressed,
    );
    const releasedAtDeepLine = surplusDrawable(
      market.stock, info.consumerDeepLine, false, info.demand, info.production,
      info.productionSuppressed,
    );
    const released = Math.max(0, releasedNow - releasedAtDeepLine);
    if (released > 0) {
      releasedByGood.set(market.goodId, (releasedByGood.get(market.goodId) ?? 0) + released);
    }
  }
  return releasedByGood;
}

/** Fold one logistics-boundary tick's lane rows: utilisation (booked ÷ `laneCapacity(level) ×
 *  catchUp`) over every lane with capacity > 0, plus this cycle's booked/blocked contribution to
 *  the per-lane running sums `topDecileShare`, `blockedVolume` and `queuedVsRealised` read. */
export function sampleLaneUtilisation(
  acc: LaneRunAccumulator,
  lanes: ReadonlyArray<WorldLane>,
  catchUp: number,
): void {
  for (const lane of lanes) {
    const capacity = laneCapacity(lane.level) * catchUp;
    const entry = perLaneEntry(acc, lane.key);
    entry.bookedSum += lane.bookedLoad;
    entry.blockedSum += lane.blockedVolume;
    if (capacity <= 0) continue;
    const ratio = lane.bookedLoad / capacity;
    acc.utilSamples.push(ratio);
    if (ratio >= 1) acc.saturatedSamples++;
    entry.utilSum += ratio;
    entry.utilCount++;
  }
}

/** Fold one tick's in-flight tonnage: Σ outbound `pendingArrivals` quantity — return-leg rows are
 *  goods heading back to a donor, not outbound haul volume, and are excluded (matches
 *  `scheduledInbound`'s own outbound-only convention, `lib/engine/freight.ts`). */
export function sampleInTransitVolume(
  acc: LaneRunAccumulator,
  pendingArrivals: ReadonlyArray<WorldPendingArrival>,
): void {
  let sum = 0;
  for (const a of pendingArrivals) {
    if (a.leg === "outbound") sum += a.quantity;
  }
  acc.inTransitSamples.push(sum);
}

/** Fold one tick's live ledger into per-lane occupancy: each row's quantity is attributed to
 *  whichever lane it is PHYSICALLY crossing at `tick` (`currentHopIndex`, `lib/engine/freight.ts`)
 *  — the same read the lane card's `inFlight` performs — never every lane its route ever touches. A
 *  row on no hop right now (already drained) contributes nothing.
 *
 *  `hopFuelCostsOf` must return one fuel cost per `routeEdges` hop, built once per call from the
 *  lane network's static fuel costs (never persisted on the row) — see `currentHopIndex`'s own
 *  build-once contract. */
export function sampleLaneOccupancy(
  acc: LaneRunAccumulator,
  pendingArrivals: ReadonlyArray<WorldPendingArrival>,
  tick: number,
  hopFuelCostsOf: (row: WorldPendingArrival) => readonly number[],
  freightSpeed: number,
): void {
  for (const row of pendingArrivals) {
    const hop = currentHopIndex(row, tick, hopFuelCostsOf(row), freightSpeed);
    if (hop === null) continue;
    perLaneEntry(acc, row.routeEdges[hop]).inTransitSum += row.quantity;
  }
}

/** Fold one tick's freshly-dispatched outbound rows (`dispatchTick === tick`) into the
 *  foreign-transit share: a haul is foreign-transit when any lane it crosses has an endpoint owned
 *  by a faction other than the hauler and other than nobody — ANY non-hauler owner, not gated by
 *  relation tier (unlike `laneOpenFor`, which only OPENS a lane at friendly/allied; this measures
 *  whether the crossing happened at all). `ownerAt` reads ownership AT DISPATCH TICK.
 *
 *  Deliberately ROUTE-WIDE, unlike `sampleLaneOccupancy` above: this is a one-shot classification
 *  made once at dispatch (this haul WILL cross foreign territory somewhere on its route), not a
 *  live per-tick "physically on this lane now" read — the same route-wide reasoning
 *  `flowsCrossingEdge` (`lib/engine/freight.ts`) uses for war's interdiction query.
 *
 *  Also retains each row into `dispatchSamples` when its `arrivalTick` falls in the ten cycles
 *  (`INBOUND_LATENCY_WINDOW_TICKS`) immediately before `acc.tickCount` — `inboundLatency`'s whole
 *  population, read back from these rows rather than accumulated inline, since the metric groups
 *  by sink and needs every row in hand to do it. `leg !== "outbound"` is filtered defensively:
 *  the caller already passes only outbound rows (`dispatchedThisTick`), but a return leg is not
 *  outbound haul volume and must never enter either reading here. */
export function sampleLaneDispatch(
  acc: LaneRunAccumulator,
  dispatchedThisTick: ReadonlyArray<WorldPendingArrival>,
  lanesByKey: ReadonlyMap<string, Pick<WorldLane, "aId" | "bId">>,
  ownerAt: (systemId: string) => string | null,
): void {
  for (const row of dispatchedThisTick) {
    if (row.leg !== "outbound") continue;
    acc.totalDispatchQty += row.quantity;
    let foreign = false;
    for (const laneKey of row.routeEdges) {
      const lane = lanesByKey.get(laneKey);
      if (!lane) continue;
      const aOwner = ownerAt(lane.aId);
      const bOwner = ownerAt(lane.bId);
      if ((aOwner !== null && aOwner !== row.factionId) || (bOwner !== null && bOwner !== row.factionId)) {
        foreign = true;
        break;
      }
    }
    if (foreign) acc.foreignDispatchQty += row.quantity;

    if (row.arrivalTick > acc.tickCount - INBOUND_LATENCY_WINDOW_TICKS && row.arrivalTick <= acc.tickCount) {
      acc.dispatchSamples.push({
        dispatchTick: row.dispatchTick,
        arrivalTick: row.arrivalTick,
        toSystemId: row.toSystemId,
        goodId: row.goodId,
        quantity: row.quantity,
      });
    }
  }
}

/** Fold one cycle's `RouteBlocked` entries (`TickProcessorResult.logisticsBlocked`) into
 *  `contentionShortfallByFaction` — Σ blocked quantity × foreignShare, per hauling faction key. */
export function recordLogisticsBlocked(
  acc: LaneRunAccumulator,
  blocked: ReadonlyArray<LogisticsBlockedEntry>,
): void {
  for (const b of blocked) {
    acc.contentionShortfallByFaction.set(
      b.factionKey,
      (acc.contentionShortfallByFaction.get(b.factionKey) ?? 0) + b.quantity * b.foreignShare,
    );
  }
}

export function recordOvershootVolume(acc: LaneRunAccumulator, overshootVolume: number): void {
  acc.overshootVolumeTotal += overshootVolume;
}

export function recordBudgetSkipped(acc: LaneRunAccumulator, budgetSkipped: number): void {
  acc.budgetSkippedTotal += budgetSkipped;
}

// ── Summary ───────────────────────────────────────────────────────

export interface LaneUtilisationSummary {
  p50: number;
  p90: number;
  max: number;
  /** Share of samples (one per lane with capacity > 0, per sampled boundary tick) at/above 1. */
  saturatedShare: number;
}

export interface LaneTopEntry {
  laneKey: string;
  blocked: number;
}

export interface LaneBlockedVolumeSummary {
  total: number;
  topLanes: LaneTopEntry[];
}

export interface LaneTopInTransitEntry {
  laneKey: string;
  inTransit: number;
}

export interface LaneQueuedVsRealisedSummary {
  /** Lanes carrying an open `lane_upgrade` project at run end — this row's own denominator. */
  laneCount: number;
  meanQueuedLevels: number;
  /** Mean, over those same lanes, of that lane's own mean utilisation across the run — 0 for a lane
   *  never sampled (never reached a logistics boundary with capacity > 0). */
  meanUtilisation: number;
}

export interface ContentionShortfallEntry {
  factionKey: string | null;
  shortfall: number;
}

export interface SurvivalStockFallingSummary {
  count: number;
  share: number;
}

/**
 * The re-measure metric — the falsifier's own instrument, promoted from `temp/depot-diag.ts` — plus
 * the guards beside it (spec §6): served-sink count, median raise size, hauls per served sink and
 * the unweighted per-haul latency distribution, so a fall driven by more, smaller, nearer raises
 * reads differently from stock actually released nearer.
 */
export interface InboundLatencySummary {
  /** Distinct sinks (`toSystemId`) with at least one dispatch row in the window. */
  servedSinks: number;
  /** Share of served sinks whose volume-weighted mean inbound latency (Σ latency×qty ÷ Σqty over
   *  every row landing at that sink) exceeds 24 ticks — STRICT: a sink at exactly 24 is not over. */
  shareOver24Ticks: number;
  /** The same share, restricted to the TREATED cohort — sinks with at least one served (sink, good)
   *  market reading `supplier` or `idle` at the horizon. This is the falsifier's own reading (§10):
   *  the design withholds the floor from a gate-excluded sink, so folding it in would blame the
   *  rule for a cohort it was never meant to move. */
  shareOver24TreatedCohort: number;
  /** Served sinks in the treated cohort — `shareOver24TreatedCohort`'s own denominator. */
  treatedSinks: number;
  /** Share of served sinks that are gate-excluded: NOT treated, and with at least one served
   *  (sink, good) market whose late-inbound share exceeds `SUPPLIER_LATE_SHARE` — the cohort the
   *  supplier role deliberately withholds the floor from (spec §4). */
  gateExcludedShare: number;
  gateExcludedSinks: number;
  /** Median row quantity over the window — unweighted, one entry per haul. */
  medianRaiseSize: number;
  /** Rows in the window ÷ served sinks. */
  haulsPerServedSink: number;
  /** Unweighted per-haul latency (`arrivalTick − dispatchTick`) — median and P90. */
  perHaulLatencyP50: number;
  perHaulLatencyP90: number;
}

/** One harness role's physical stock against the ration line — stock IN HAND, never counted
 *  (scheduled-inbound-inclusive) stock, so a supplier with a full raise in flight cannot read as
 *  safe on inbound it does not yet hold (spec §4's "the warning is a counted figure" caveat). */
export interface PhysicalCoverAtRationEntry {
  role: MarketRole;
  /** Markets in this role with use (`GoodMarketState.demand`) > 0 — the row's own denominator. */
  n: number;
  medianCoverCycles: number;
  /** Share of `n` with `stock < RATION_COVER × use`. */
  underRationShare: number;
}

/** Markets under a deep anchor cut (`anchorMult < 0.5`) at the horizon, by role, with how many sit
 *  at or above their production-brake knee (spec §4's accepted cost: a part-producer's buffer
 *  rides out the cut anchor-immune while its brake knee does not). Every `MarketRole` gets a row,
 *  zeroed if the cohort is empty — never a missing entry, never NaN. */
export interface AnchorEventCohortEntry {
  role: MarketRole;
  count: number;
  brakedCount: number;
}

/** The first logistics run whose freshly-released supplier/idle stock summed above 0 — `tick: null`
 *  and every total 0 when no run in this run ever crossed it (spec §6's first-release transient
 *  read). */
export interface ReleasedTonnageFirstCycleSummary {
  tick: number | null;
  total: number;
  byGood: Array<{ goodId: string; quantity: number }>;
}

export interface LaneMetricsSummary {
  utilisation: LaneUtilisationSummary;
  /** Share of Σ booked (real, not projected) carried by the top 10% of lanes by Σ booked. */
  topDecileShare: number;
  /** `mean`/`max` are the network-wide total sampled once per tick (`sampleInTransitVolume`) — every
   *  in-flight row counted once, regardless of how many lanes its route crosses — OUTBOUND legs
   *  only. `topLanes` is the per-lane physically-crossing read (`sampleLaneOccupancy`) — the
   *  harness-side reading of the lane card's `inFlight`, which counts BOTH legs, since a return
   *  haul occupies the lane it is on just as an outbound one does. The two are therefore different
   *  populations and do not sum to each other. */
  inTransitVolume: { mean: number; max: number; topLanes: LaneTopInTransitEntry[] };
  blockedVolume: LaneBlockedVolumeSummary;
  queuedVsRealised: LaneQueuedVsRealisedSummary;
  foreignTransitShare: number;
  contentionShortfallByFaction: ContentionShortfallEntry[];
  overshootVolume: number;
  budgetSkipped: number;
  survivalStockFalling: SurvivalStockFallingSummary;
  inboundLatency: InboundLatencySummary;
  /** Σ billed logistics work ÷ Σ arrivals-credited quantity, both gated to `LOGISTICS_WARMUP_TICKS`
   *  — relaying bills every leg, so this rises with chain depth while delivered tonnage does not
   *  (spec §6). 0 when nothing was delivered in the window. */
  logisticsWorkPerDeliveredUnit: number;
  fundingBoundIncidenceByFaction: FundingBoundIncidenceEntry[];
  physicalCoverAtRationByRole: PhysicalCoverAtRationEntry[];
  anchorEventCohort: AnchorEventCohortEntry[];
  releasedTonnageFirstCycle: ReleasedTonnageFirstCycleSummary;
}

/** `Math.max(...xs)` blows the call stack on a large array (a multi-thousand-tick run's
 *  per-lane-per-cycle sample count) — spreading passes every element as a call argument. */
function maxOf(xs: ReadonlyArray<number>): number {
  let m = 0;
  for (const x of xs) if (x > m) m = x;
  return m;
}

function topDecileShareOf(perLane: ReadonlyMap<string, PerLane>): number {
  const sums = [...perLane.values()].map((v) => v.bookedSum).filter((v) => v > 0);
  if (sums.length === 0) return 0;
  const total = sums.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  const sorted = [...sums].sort((a, b) => b - a);
  const topN = Math.max(1, Math.ceil(sorted.length * 0.1));
  const topSum = sorted.slice(0, topN).reduce((a, b) => a + b, 0);
  return topSum / total;
}

function summariseQueuedVsRealised(
  perLane: ReadonlyMap<string, PerLane>,
  constructionProjects: ReadonlyArray<WorldConstructionProject>,
): LaneQueuedVsRealisedSummary {
  const laneUpgrades = constructionProjects.filter(
    (p): p is Extract<WorldConstructionProject, { kind: "lane_upgrade" }> => p.kind === "lane_upgrade",
  );
  if (laneUpgrades.length === 0) return { laneCount: 0, meanQueuedLevels: 0, meanUtilisation: 0 };
  let queuedSum = 0;
  let utilSum = 0;
  let utilLaneCount = 0;
  for (const p of laneUpgrades) {
    queuedSum += p.levels;
    const entry = perLane.get(p.laneKey);
    if (entry && entry.utilCount > 0) {
      utilSum += entry.utilSum / entry.utilCount;
      utilLaneCount++;
    }
  }
  return {
    laneCount: laneUpgrades.length,
    meanQueuedLevels: queuedSum / laneUpgrades.length,
    meanUtilisation: utilLaneCount > 0 ? utilSum / utilLaneCount : 0,
  };
}

/** At run end: developed systems whose water or food cycles-to-empty (`survivalCyclesToEmpty`)
 *  falls below `SURVIVAL_STOCK_CYCLES_THRESHOLD` — the alert bar's own rule, read off the final
 *  market rows rather than accumulated, since this is a point-in-time census, not a whole-run fold. */
function computeSurvivalStockFalling(
  developedSystemIds: ReadonlySet<string>,
  markets: ReadonlyArray<WorldMarket>,
): SurvivalStockFallingSummary {
  const fallingSystems = new Set<string>();
  for (const m of markets) {
    if (!developedSystemIds.has(m.systemId)) continue;
    if (!SURVIVAL_GOODS.includes(m.goodId)) continue;
    const cyclesToEmpty = survivalCyclesToEmpty(m.stock, m.stockChange);
    if (cyclesToEmpty !== null && cyclesToEmpty < SURVIVAL_STOCK_CYCLES_THRESHOLD) {
      fallingSystems.add(m.systemId);
    }
  }
  return {
    count: fallingSystems.size,
    share: developedSystemIds.size > 0 ? fallingSystems.size / developedSystemIds.size : 0,
  };
}

const EMPTY_INBOUND_LATENCY: InboundLatencySummary = {
  servedSinks: 0, shareOver24Ticks: 0, shareOver24TreatedCohort: 0, treatedSinks: 0,
  gateExcludedShare: 0, gateExcludedSinks: 0, medianRaiseSize: 0, haulsPerServedSink: 0,
  perHaulLatencyP50: 0, perHaulLatencyP90: 0,
};

/**
 * The re-measure metric: group the window's dispatch rows by sink (`toSystemId`), take each
 * sink's volume-weighted mean latency, and share the sinks whose mean is strictly over 24 ticks —
 * `temp/depot-diag.ts`'s Claim-1 arithmetic exactly. The treated/gate-excluded split additionally
 * classifies each sink by ANY of its served (sink, good) markets' role/late-inbound-share at the
 * horizon (`targetsByKey`, from `logisticsTargetsByKey` — reused, not rebuilt).
 */
function summariseInboundLatency(
  rows: ReadonlyArray<DispatchSample>,
  targetsByKey: ReadonlyMap<string, LogisticsTargetInfo>,
): InboundLatencySummary {
  if (rows.length === 0) return EMPTY_INBOUND_LATENCY;

  const sinks = new Map<string, { volume: number; latencyVolume: number; goodIds: Set<string> }>();
  const quantities: number[] = [];
  const latencies: number[] = [];
  for (const row of rows) {
    const latency = row.arrivalTick - row.dispatchTick;
    quantities.push(row.quantity);
    latencies.push(latency);
    let sink = sinks.get(row.toSystemId);
    if (!sink) {
      sink = { volume: 0, latencyVolume: 0, goodIds: new Set() };
      sinks.set(row.toSystemId, sink);
    }
    sink.volume += row.quantity;
    sink.latencyVolume += latency * row.quantity;
    sink.goodIds.add(row.goodId);
  }

  let over24 = 0;
  let treated = 0;
  let treatedOver24 = 0;
  let gateExcluded = 0;
  for (const [sinkId, sink] of sinks) {
    const mean = sink.volume > 0 ? sink.latencyVolume / sink.volume : 0;
    const isOver24 = mean > 24;
    if (isOver24) over24++;

    let isTreated = false;
    let isGateExcluded = false;
    for (const goodId of sink.goodIds) {
      const info = targetsByKey.get(`${sinkId}|${goodId}`);
      if (!info) continue;
      if (info.role === "supplier" || info.role === "idle") isTreated = true;
      if (info.lateInboundShare !== undefined && info.lateInboundShare > DIRECTED_LOGISTICS.SUPPLIER_LATE_SHARE) {
        isGateExcluded = true;
      }
    }
    if (isTreated) {
      treated++;
      if (isOver24) treatedOver24++;
    } else if (isGateExcluded) {
      gateExcluded++;
    }
  }

  const servedSinks = sinks.size;
  return {
    servedSinks,
    shareOver24Ticks: servedSinks > 0 ? over24 / servedSinks : 0,
    shareOver24TreatedCohort: treated > 0 ? treatedOver24 / treated : 0,
    treatedSinks: treated,
    gateExcludedShare: servedSinks > 0 ? gateExcluded / servedSinks : 0,
    gateExcludedSinks: gateExcluded,
    medianRaiseSize: median(quantities),
    haulsPerServedSink: servedSinks > 0 ? rows.length / servedSinks : 0,
    perHaulLatencyP50: median(latencies),
    perHaulLatencyP90: quantile(latencies, 0.9),
  };
}

/** Physical stock ÷ use in cycles, per harness role, over markets with use > 0 at the horizon —
 *  stock IN HAND, never counted stock (spec §4). */
function computePhysicalCoverAtRationByRole(
  finalMarkets: ReadonlyArray<WorldMarket>,
  rolesByKey: ReadonlyMap<string, MarketRoleInfo>,
): PhysicalCoverAtRationEntry[] {
  const coversByRole = new Map<MarketRole, number[]>();
  const underByRole = new Map<MarketRole, number>();
  for (const m of finalMarkets) {
    const info = rolesByKey.get(`${m.systemId}|${m.goodId}`);
    if (!info || !(info.demand > 0)) continue;
    const list = coversByRole.get(info.role) ?? [];
    list.push(m.stock / info.demand);
    coversByRole.set(info.role, list);
    if (m.stock < ECONOMY_CONSTANTS.RATION_COVER * info.demand) {
      underByRole.set(info.role, (underByRole.get(info.role) ?? 0) + 1);
    }
  }
  const result: PhysicalCoverAtRationEntry[] = [];
  for (const role of MARKET_ROLES) {
    const list = coversByRole.get(role);
    if (!list || list.length === 0) continue;
    result.push({
      role,
      n: list.length,
      medianCoverCycles: median(list),
      underRationShare: (underByRole.get(role) ?? 0) / list.length,
    });
  }
  return result;
}

/** Markets under a deep anchor cut, by role, with brake state — `market.stock >= knee` is the same
 *  "braked" test `market-analysis.ts`'s knee-binding census uses. Every role gets a row, zeroed for
 *  an empty cohort, never omitted (spec §6's zero-cohort convention). */
function computeAnchorEventCohort(
  finalMarkets: ReadonlyArray<WorldMarket>,
  rolesByKey: ReadonlyMap<string, MarketRoleInfo>,
  targetsByKey: ReadonlyMap<string, LogisticsTargetInfo>,
): AnchorEventCohortEntry[] {
  const byRole = new Map<MarketRole, { count: number; braked: number }>();
  for (const m of finalMarkets) {
    if (!(m.anchorMult < 0.5)) continue;
    const key = `${m.systemId}|${m.goodId}`;
    const roleInfo = rolesByKey.get(key);
    if (!roleInfo) continue;
    const target = targetsByKey.get(key);
    const knee = brakeKnee(
      {
        useRate: roleInfo.demand,
        capacityProduction: target?.capacityProduction ?? 0,
        anchorMult: m.anchorMult,
      },
      ECONOMY_SIM_PARAMS,
    );
    const entry = byRole.get(roleInfo.role) ?? { count: 0, braked: 0 };
    entry.count++;
    if (m.stock >= knee.knee) entry.braked++;
    byRole.set(roleInfo.role, entry);
  }
  return MARKET_ROLES.map((role) => {
    const entry = byRole.get(role);
    return { role, count: entry?.count ?? 0, brakedCount: entry?.braked ?? 0 };
  });
}

function summariseReleasedTonnage(
  releasedFirst: LaneRunAccumulator["releasedFirst"],
): ReleasedTonnageFirstCycleSummary {
  if (!releasedFirst) return { tick: null, total: 0, byGood: [] };
  let total = 0;
  const byGood: Array<{ goodId: string; quantity: number }> = [];
  for (const [goodId, quantity] of releasedFirst.totalsByGood) {
    total += quantity;
    byGood.push({ goodId, quantity });
  }
  return { tick: releasedFirst.tick, total, byGood };
}

/** Fold the whole run's accumulator plus the final world's queue and market rows into the report.
 *  `targetsByKey` (`logisticsTargetsByKey`) and `rolesByKey` (`marketRolesByKey`) are the horizon's
 *  role reads the caller already built for `marketHealth`/`roleCoverLevels` — reused here, not
 *  recomputed, so the re-measure metric's cohorts can never silently disagree with the rest of the
 *  report's partition. `fundingBoundByFaction` is likewise computed once by the caller
 *  (`logistics-analysis.ts`) and folded straight through. All three default to empty so existing
 *  callers that only exercise the pre-existing lane-mechanics fields are unaffected. */
export function summariseLanes(
  acc: LaneRunAccumulator,
  constructionProjects: ReadonlyArray<WorldConstructionProject>,
  developedSystemIds: ReadonlySet<string>,
  finalMarkets: ReadonlyArray<WorldMarket>,
  targetsByKey: ReadonlyMap<string, LogisticsTargetInfo> = new Map(),
  rolesByKey: ReadonlyMap<string, MarketRoleInfo> = new Map(),
  fundingBoundByFaction: FundingBoundIncidenceEntry[] = [],
): LaneMetricsSummary {
  const utilSamples = acc.utilSamples;
  const inTransit = acc.inTransitSamples;
  const blockedEntries: LaneTopEntry[] = [...acc.perLane.entries()].map(([laneKey, v]) => ({
    laneKey,
    blocked: v.blockedSum,
  }));
  const blockedTotal = blockedEntries.reduce((a, e) => a + e.blocked, 0);
  const topLanes = [...blockedEntries].sort((a, b) => b.blocked - a.blocked).slice(0, 5);
  const inTransitEntries: LaneTopInTransitEntry[] = [...acc.perLane.entries()].map(([laneKey, v]) => ({
    laneKey,
    inTransit: v.inTransitSum,
  }));
  const topInTransitLanes = [...inTransitEntries].sort((a, b) => b.inTransit - a.inTransit).slice(0, 5);

  return {
    utilisation: {
      p50: median(utilSamples),
      p90: quantile(utilSamples, 0.9),
      max: maxOf(utilSamples),
      saturatedShare: utilSamples.length > 0 ? acc.saturatedSamples / utilSamples.length : 0,
    },
    topDecileShare: topDecileShareOf(acc.perLane),
    inTransitVolume: {
      mean: inTransit.length > 0 ? inTransit.reduce((a, b) => a + b, 0) / inTransit.length : 0,
      max: maxOf(inTransit),
      topLanes: topInTransitLanes,
    },
    blockedVolume: { total: blockedTotal, topLanes },
    queuedVsRealised: summariseQueuedVsRealised(acc.perLane, constructionProjects),
    foreignTransitShare: acc.totalDispatchQty > 0 ? acc.foreignDispatchQty / acc.totalDispatchQty : 0,
    contentionShortfallByFaction: [...acc.contentionShortfallByFaction.entries()]
      .map(([factionKey, shortfall]) => ({ factionKey, shortfall }))
      .sort((a, b) => b.shortfall - a.shortfall),
    overshootVolume: acc.overshootVolumeTotal,
    budgetSkipped: acc.budgetSkippedTotal,
    survivalStockFalling: computeSurvivalStockFalling(developedSystemIds, finalMarkets),
    inboundLatency: summariseInboundLatency(acc.dispatchSamples, targetsByKey),
    logisticsWorkPerDeliveredUnit: acc.totalDeliveredQty > 0 ? acc.totalWork / acc.totalDeliveredQty : 0,
    fundingBoundIncidenceByFaction: fundingBoundByFaction,
    physicalCoverAtRationByRole: computePhysicalCoverAtRationByRole(finalMarkets, rolesByKey),
    anchorEventCohort: computeAnchorEventCohort(finalMarkets, rolesByKey, targetsByKey),
    releasedTonnageFirstCycle: summariseReleasedTonnage(acc.releasedFirst),
  };
}
