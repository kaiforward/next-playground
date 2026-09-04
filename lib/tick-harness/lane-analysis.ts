/**
 * Lane-mechanics analysis for the calibration harness (spec §8): whole-run lane utilisation,
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
import { survivalCyclesToEmpty, SURVIVAL_STOCK_CYCLES_THRESHOLD } from "@/lib/engine/survival-stock";
import { SURVIVAL_GOODS } from "@/lib/constants/physical-economy";
import type { LogisticsBlockedEntry } from "@/lib/engine/lane-routing";
import { median, quantile } from "@/lib/utils/math";
import type { WorldConstructionProject, WorldLane, WorldMarket, WorldPendingArrival } from "@/lib/world/types";

// ── Accumulator ───────────────────────────────────────────────────

interface PerLane {
  bookedSum: number;
  blockedSum: number;
  utilSum: number;
  utilCount: number;
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
}

export function newLaneRunAccumulator(): LaneRunAccumulator {
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
  };
}

function perLaneEntry(acc: LaneRunAccumulator, key: string): PerLane {
  let entry = acc.perLane.get(key);
  if (!entry) {
    entry = { bookedSum: 0, blockedSum: 0, utilSum: 0, utilCount: 0 };
    acc.perLane.set(key, entry);
  }
  return entry;
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

/** Fold one tick's freshly-dispatched outbound rows (`dispatchTick === tick`) into the
 *  foreign-transit share: a haul is foreign-transit when any lane it crosses has an endpoint owned
 *  by a faction other than the hauler and other than nobody — ANY non-hauler owner, not gated by
 *  relation tier (unlike `laneOpenFor`, which only OPENS a lane at friendly/allied; this measures
 *  whether the crossing happened at all). `ownerAt` reads ownership AT DISPATCH TICK. */
export function sampleLaneDispatch(
  acc: LaneRunAccumulator,
  dispatchedThisTick: ReadonlyArray<WorldPendingArrival>,
  lanesByKey: ReadonlyMap<string, Pick<WorldLane, "aId" | "bId">>,
  ownerAt: (systemId: string) => string | null,
): void {
  for (const row of dispatchedThisTick) {
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

export interface LaneMetricsSummary {
  utilisation: LaneUtilisationSummary;
  /** Share of Σ booked (real, not projected) carried by the top 10% of lanes by Σ booked. */
  topDecileShare: number;
  inTransitVolume: { mean: number; max: number };
  blockedVolume: LaneBlockedVolumeSummary;
  queuedVsRealised: LaneQueuedVsRealisedSummary;
  foreignTransitShare: number;
  contentionShortfallByFaction: ContentionShortfallEntry[];
  overshootVolume: number;
  budgetSkipped: number;
  survivalStockFalling: SurvivalStockFallingSummary;
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

/** Fold the whole run's accumulator plus the final world's queue and market rows into the report. */
export function summariseLanes(
  acc: LaneRunAccumulator,
  constructionProjects: ReadonlyArray<WorldConstructionProject>,
  developedSystemIds: ReadonlySet<string>,
  finalMarkets: ReadonlyArray<WorldMarket>,
): LaneMetricsSummary {
  const utilSamples = acc.utilSamples;
  const inTransit = acc.inTransitSamples;
  const blockedEntries: LaneTopEntry[] = [...acc.perLane.entries()].map(([laneKey, v]) => ({
    laneKey,
    blocked: v.blockedSum,
  }));
  const blockedTotal = blockedEntries.reduce((a, e) => a + e.blocked, 0);
  const topLanes = [...blockedEntries].sort((a, b) => b.blocked - a.blocked).slice(0, 5);

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
  };
}
