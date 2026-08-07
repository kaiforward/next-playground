import type { TickSystem } from "@/lib/tick/rows";
import {
  crowdFactor, dissatisfaction, foldSupplyState, provision, worstDemandedGoods,
  type DemandedGoodReading, type SupplyRegime,
} from "@/lib/engine/population";
import { goodSatisfactionsBySystem } from "@/lib/tick-harness/good-satisfaction";
import { aggregateModifiers, buildModifiersForPhase, type ModifierRow } from "@/lib/engine/events";
import { EVENT_DEFINITIONS, MODIFIER_CAPS } from "@/lib/constants/events";
import { median, quantile } from "@/lib/utils/math";
import type { WorldEvent, WorldMarket } from "@/lib/world/types";

export interface InfrastructureSummary {
  /** Total building count across all systems at tick 0. */
  builtStart: number;
  /** Total building count across all systems at simulation end. */
  builtEnd: number;
  /** Percentage of the built base that decayed away. */
  decayedPct: number;
  /** Systems whose entire built base has rotted to ~0 (ghost-industry watch). */
  collapsedCount: number;
}

/**
 * A system somebody actually lives on. Every population/infrastructure reading below is a statement
 * about inhabited worlds, and the galaxy is overwhelmingly empty — at default scale 580 of 600
 * systems are unclaimed. Folding those in turns a rate into a measure of how much void was generated.
 */
function isSettled(s: TickSystem): boolean {
  return s.control === "developed";
}

/** Σ of all building counts in a system. */
function totalBuilt(s: TickSystem): number {
  let n = 0;
  for (const count of Object.values(s.buildings)) n += Math.max(0, count);
  return n;
}

export function summarizeInfrastructure(
  systems: TickSystem[],
  initialBuildingTotal: number,
): InfrastructureSummary {
  let builtEnd = 0;
  let collapsedCount = 0;
  for (const s of systems) {
    const built = totalBuilt(s);
    builtEnd += built;
    // Only a SETTLED system can have collapsed. An unclaimed rock has no buildings because nobody
    // ever built any — counting it as ghost industry buries the handful of real collapses under
    // however many systems the galaxy happens to contain.
    if (built < 1 && isSettled(s)) collapsedCount++;
  }
  return {
    builtStart: initialBuildingTotal,
    builtEnd,
    decayedPct: initialBuildingTotal > 0 ? ((initialBuildingTotal - builtEnd) / initialBuildingTotal) * 100 : 0,
    collapsedCount,
  };
}

/**
 * Migration ping-pong: a system whose population direction reverses many times
 * across snapshots is oscillating (two systems trading the same people). Counts
 * systems with ≥ minReversals sign changes in successive population deltas.
 */
export function detectPingPong(
  snapshots: Array<Map<string, number>>, minReversals = 4,
): number {
  if (snapshots.length < 3) return 0;
  const ids = snapshots[0].keys();
  let count = 0;
  for (const id of ids) {
    let reversals = 0;
    let prevSign = 0;
    for (let i = 1; i < snapshots.length; i++) {
      const delta = (snapshots[i].get(id) ?? 0) - (snapshots[i - 1].get(id) ?? 0);
      const sign = Math.sign(delta);
      if (sign !== 0 && prevSign !== 0 && sign !== prevSign) reversals++;
      if (sign !== 0) prevSign = sign;
    }
    if (reversals >= minReversals) count++;
  }
  return count;
}

export interface PopulationSummary {
  totalStart: number;
  totalEnd: number;
  growthPct: number;
  meanUnrest: number;
  maxUnrest: number;
  // Every field below counts, averages, or shares over SETTLED systems only (`totalStart`/`totalEnd`
  // are galaxy-wide, but an unsettled system holds no people so the two agree). The galaxy is mostly
  // void by design — rating unrest or striking against 600 systems when 20 are inhabited reports the
  // emptiness of space, not the health of the economy.
  /** Systems within 2% of popCap — the crowd brake's healthy resting state (growth runs at full
   *  rate to r = population/popCap = 1, then brakes smoothly), not a saturation pathology. */
  saturatedCount: number;
  /** Systems with popCap > 0 whose growth brake has crushed to <= 0.25 (crowdFactor near the
   *  brake's end, r near CROWDING.BRAKE_END) — the pathology watch: pinned at the brake while
   *  relief housing exists and land is available means the growth valve is blocked, not that the
   *  world is genuinely full. The count itself checks neither, so a high reading is a prompt to
   *  look at land and relief builds, not evidence on its own that the valve is at fault. */
  brakedCount: number;
  /** Mean population/popCap across systems with popCap > 0 — the occupancy watch's headline
   *  number. 0 when no system has any housing (guarded so an all-zero-popCap run reports 0,
   *  never NaN). */
  meanOccupancy: number;
  /** Systems with population ≤ 1 (ghost-town watch). */
  emptiedCount: number;
  /** Systems with unrest ≥ strikeThreshold (striking). */
  strikingCount: number;
  /** Striking systems as a share of those counted, in [0,1]. The count alone reads differently as
   *  the galaxy grows — 300 striking of 400 and 300 of 3000 are not the same galaxy. */
  strikingShare: number;
  /** Systems holding population with effectively no housing left (popCap ≈ 0). The trap the collapse
   *  channel's housing floor closes: with popCap 0 the crowd brake reads fully crowded so growth is
   *  exactly zero, overshoot-death fires, and the relief valve cannot rebuild until the system is
   *  fed — which needs the capacity just demolished. Should read ~0; anything else is a population
   *  that cannot grow, shrink into safety, or be helped. */
  strandedCount: number;
  /** Total population held in those stranded systems — how many people are actually caught, which
   *  the count alone does not say. */
  strandedPopulation: number;
}

/** popCap at or below this counts as "no housing left" — popCap is a whole-level multiple, so this
 *  is comfortably below one level rather than an arbitrary epsilon. */
const STRANDED_POP_CAP = 1e-6;

export function summarizePopulation(
  systems: TickSystem[],
  totalStart: number,
  strikeThreshold: number,
  crowdBrakeEnd: number,
): PopulationSummary {
  let totalEnd = 0;
  let unrestSum = 0;
  let maxUnrest = 0;
  let saturatedCount = 0;
  let brakedCount = 0;
  let occupancySum = 0;
  let occupancyCount = 0;
  let emptiedCount = 0;
  let strikingCount = 0;
  let strandedCount = 0;
  let strandedPopulation = 0;

  // Totals are over the whole galaxy (an unsettled system holds no people, so it adds nothing);
  // every rate, share and count below is over settled systems, which is what they are claims about.
  for (const s of systems) totalEnd += s.population;
  const settled = systems.filter(isSettled);

  for (const s of settled) {
    unrestSum += s.unrest;
    if (s.unrest > maxUnrest) maxUnrest = s.unrest;
    if (s.population > 0 && s.popCap <= STRANDED_POP_CAP) {
      strandedCount++;
      strandedPopulation += s.population;
    }
    if (s.popCap > 0) {
      if (s.population >= s.popCap * 0.98) saturatedCount++;
      if (crowdFactor(s.population, s.popCap, crowdBrakeEnd) <= 0.25) brakedCount++;
      occupancySum += s.population / s.popCap;
      occupancyCount++;
    }
    if (s.population <= 1) emptiedCount++;
    if (s.unrest >= strikeThreshold) strikingCount++;
  }

  const n = Math.max(1, settled.length);
  return {
    totalStart,
    totalEnd,
    growthPct: totalStart > 0 ? ((totalEnd - totalStart) / totalStart) * 100 : 0,
    meanUnrest: unrestSum / n,
    maxUnrest,
    saturatedCount,
    brakedCount,
    meanOccupancy: occupancyCount > 0 ? occupancySum / occupancyCount : 0,
    emptiedCount,
    strikingCount,
    strikingShare: settled.length > 0 ? strikingCount / settled.length : 0,
    strandedCount,
    strandedPopulation,
  };
}

/** Active economy-domain modifier rows, rebuilt from the final world's persisted events. */
function economyModifiers(events: ReadonlyArray<WorldEvent>): ModifierRow[] {
  const out: ModifierRow[] = [];
  for (const e of events) {
    const phase = EVENT_DEFINITIONS[e.type]?.phases.find((p) => p.name === e.phase);
    if (!phase) continue;
    for (const mod of buildModifiersForPhase(phase, e.systemId, e.regionId, e.severity)) {
      if (mod.domain === "economy") out.push(mod);
    }
  }
  return out;
}

/**
 * Per-system consumption-rate multipliers from active events, matching what the economy processor
 * applies to `demanded`. Returns undefined when nothing is active, so the common case costs nothing.
 */
function consumptionMultBySystem(
  systems: TickSystem[],
  events: ReadonlyArray<WorldEvent>,
): Map<string, ModifierRow[]> | undefined {
  const mods = economyModifiers(events);
  if (mods.length === 0) return undefined;
  const bySystem = new Map<string, ModifierRow[]>();
  for (const s of systems) {
    const own = mods.filter(
      (m) =>
        (m.targetType === "system" && m.targetId === s.id) ||
        (m.targetType === "region" && m.targetId === s.regionId),
    );
    if (own.length > 0) bySystem.set(s.id, own);
  }
  return bySystem.size > 0 ? bySystem : undefined;
}

/**
 * Per-system share of each supply regime at the end of the run — the permanent instrument for the
 * unrest fold. Recomputed from the final world's persisted per-good satisfaction against each
 * system's own civilian demand, including any active event consumption modifiers, so it folds the
 * same `demanded` the economy cycle did rather than a parallel one. Pass the final world's `events`
 * to keep that true — omitting them silently drops the modifier term. Settled systems only: an
 * unclaimed rock has no market and no opinion.
 *
 * The modifier term is inert today: no shipped event definition carries a `consumption_rate`
 * rate_multiplier (only `production_rate` and `target_stock`), so every consumptionMult resolves to
 * 1. It is threaded anyway because the alternative is a reading that silently diverges from the tick
 * the day one is added — and rebuilding it from the persisted events, rather than storing it, is
 * what keeps the two from drifting.
 */
/** One distribution's median, 10th and 90th percentile — the shape a quantile read needs to show a
 *  bimodal population apart from a uniform one, which a mean alone cannot. */
export interface QuantileLevels {
  median: number;
  p10: number;
  p90: number;
}

function quantileLevels(xs: number[]): QuantileLevels {
  return { median: median(xs), p10: quantile(xs, 0.1), p90: quantile(xs, 0.9) };
}

export interface SupplyRegimeSummary {
  counted: number;
  supplied: number;
  rationing: number;
  shortage: number;
  suppliedShare: number;
  rationingShare: number;
  shortageShare: number;
  /** Mean D over counted systems — the magnitude behind the labels. */
  meanDissatisfaction: number;
  /** Distribution of per-system Provision (provision()) over counted systems. */
  provisionLevels: QuantileLevels;
  /** Distribution of each system's single worst-demanded-good satisfaction (worstGoods[0],
   *  or 1 for a system with no demanded goods) over counted systems. */
  worstGoodLevels: QuantileLevels;
}

/** Depth of the worst-good tail carried per system. Instrument-local — no gameplay code reads this
 *  constant or the `worstGoods` list it sizes. It exists so Gate 1 can re-slice the demand-share
 *  floor and the necessity-floor variant from readings already captured in one run, rather than
 *  re-running the simulation once per candidate value. 10 of a populated world's ~26 demanded goods
 *  is deep enough to carry the low-demand-share tail those two floors are chosen from. */
const WORST_GOOD_TAIL_DEPTH = 10;

/** One settled system's supply reading — the magnitude and the label it folds to, plus the
 *  Provision-scale readings (provision(), worstDemandedGoods()) the same basket folds to. */
export interface SystemSupplyState {
  d: number;
  regime: SupplyRegime;
  /** provision() over the same goods basket — the necessity-and-demand-weighted mean, not the fold. */
  provision: number;
  /** worstDemandedGoods() over the same basket, ascending, at most WORST_GOOD_TAIL_DEPTH entries.
   *  Instrument-local: see WORST_GOOD_TAIL_DEPTH. */
  worstGoods: DemandedGoodReading[];
}

/** A system's single worst-demanded-good satisfaction — worstGoods[0], or 1 (no shortfall) when the
 *  basket demands nothing. Shared by the galaxy-wide and cohorted folds so neither can read the
 *  empty-basket convention differently — the same "counted, not dropped" argument Provision's own
 *  empty-basket 1 makes. */
export function worstGoodSatisfaction(state: SystemSupplyState): number {
  return state.worstGoods[0]?.satisfaction ?? 1;
}

/**
 * Per-system dissatisfaction, regime and Provision at the end of the run, keyed by system id. The
 * galaxy-wide summary folds this same map, so a cohorted regime split and the galaxy-wide
 * one cannot drift apart. Settled systems only: an unclaimed rock has no market and no opinion. A
 * settled system with no market rows folds an empty goods basket, which reads Provision 1 and D 0 —
 * it is counted, not dropped, so every share and distribution denominator matches the settled set.
 */
export function perSystemSupplyState(
  systems: TickSystem[],
  markets: ReadonlyArray<Pick<WorldMarket, "systemId" | "goodId" | "satisfaction">>,
  events: ReadonlyArray<WorldEvent> = [],
): Map<string, SystemSupplyState> {
  const settledSystems = systems.filter(isSettled);
  const settled = new Map(settledSystems.map((s) => [s.id, s]));
  const modsBySystem = consumptionMultBySystem(settledSystems, events);
  const goodsBySystem = goodSatisfactionsBySystem(settled, markets, (systemId, goodId) => {
    const mods = modsBySystem?.get(systemId);
    return mods ? aggregateModifiers(mods, goodId, MODIFIER_CAPS).consumptionMult : 1;
  });

  const states = new Map<string, SystemSupplyState>();
  for (const systemId of settled.keys()) {
    const goods = goodsBySystem.get(systemId) ?? [];
    const d = dissatisfaction(goods);
    states.set(systemId, {
      d,
      regime: foldSupplyState(goods, d).regime,
      provision: provision(goods),
      worstGoods: worstDemandedGoods(goods, WORST_GOOD_TAIL_DEPTH),
    });
  }
  return states;
}

export function summarizeSupplyRegimes(
  systems: TickSystem[],
  markets: ReadonlyArray<Pick<WorldMarket, "systemId" | "goodId" | "satisfaction">>,
  events: ReadonlyArray<WorldEvent> = [],
): SupplyRegimeSummary {
  const states = perSystemSupplyState(systems, markets, events);

  let supplied = 0, rationing = 0, shortage = 0, dSum = 0;
  const provisions: number[] = [];
  const worstGoodSats: number[] = [];
  for (const state of states.values()) {
    dSum += state.d;
    provisions.push(state.provision);
    worstGoodSats.push(worstGoodSatisfaction(state));
    if (state.regime === "supplied") supplied++;
    else if (state.regime === "rationing") rationing++;
    else shortage++;
  }
  const counted = states.size;
  const share = (n: number) => (counted > 0 ? n / counted : 0);
  return {
    counted, supplied, rationing, shortage,
    suppliedShare: share(supplied),
    rationingShare: share(rationing),
    shortageShare: share(shortage),
    meanDissatisfaction: counted > 0 ? dSum / counted : 0,
    provisionLevels: quantileLevels(provisions),
    worstGoodLevels: quantileLevels(worstGoodSats),
  };
}
