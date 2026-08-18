/**
 * Cohorted harness metrics — the report's supply readings split by which role a market
 * plays for a good, and what kind of world a system is.
 *
 * Every galaxy-wide analyser beside this one keeps its own definition; this module is
 * additive, so a figure measured against the aggregate stays comparable.
 */

import { MIN_DEMAND } from "@/lib/constants/market-economy";
import { GOODS } from "@/lib/constants/goods";
import { curveForRow, marketBandForRow, midPriceAt } from "@/lib/engine/market-pricing";
import { toGoodMarketStates } from "@/lib/tick/processors/good-market-state";
import { marketRowsBySystem } from "@/lib/world/tick";
import { median } from "@/lib/utils/math";
import { nearBandFloor } from "./market-analysis";
import { perSystemSupplyState, quantileLevels, worstGoodSatisfaction } from "./population-analysis";
import type { EpisodeCostTotals } from "./population-analysis";
import type { GoodMarketState } from "@/lib/engine/directed-logistics";
import type { TickSystem } from "@/lib/tick/rows";
import type { WorldEvent, WorldMarket } from "@/lib/world/types";
import type {
  EpisodeCostCohortEntry, EpisodeCostSummary, MarketRole, RatchetBucketEntry, RatchetCheckSummary,
  RoleCoverEntry, StockedRole, WorldCohort, WorldCohortEntry,
} from "./types";

/**
 * A market's role, tested in a fixed order because one market can satisfy several
 * descriptions. `state.demand` is the unfloored logistics demand and decides exporter
 * status; `demandRate` is the MIN_DEMAND-floored pricing anchor and is the only thing
 * that can identify an inert market. They are different numbers and answer different
 * questions — MIN_DEMAND's own docstring calls it a floor on the cycles-of-supply
 * denominator "so a near-empty system yields a finite cover instead of a divide-by-zero",
 * i.e. a pricing guard, not demand.
 *
 * Precedence matters at one junction: a mining world producing ore nobody there consumes
 * has a floored demandRate and real production. It is an exporter — it genuinely ships the
 * good — so the production tests run first and `inert` means "no production, and local
 * demand below the MIN_DEMAND pricing floor" — its cover denominator is the pricing floor,
 * not real need. That is NOT the same as zero demand: a small world can have genuine demand
 * that still sits under the floor (below ~7 population for water, ~50 for electronics, ~167
 * for ship_frames) and lands here too, indistinguishable from a market nobody wants anything
 * from unless the caller also reads `state.demand` (0 vs. > 0).
 */
export function classifyMarketRole(state: GoodMarketState, demandRate: number): MarketRole {
  const production = state.production;
  // Mirrors surplusDrawable's own exporter branch, so a market this calls an exporter is
  // exactly one directed logistics would draw from.
  if (production > state.demand && !state.productionSuppressed) return "exporter";
  if (production > 0) return "self-supplier";
  // The floor is assigned from the same constant, not computed, so a floored row lands on
  // it exactly; the epsilon only guards against accumulated float drift in the industrial term.
  if (demandRate > MIN_DEMAND * (1 + 1e-9)) return "consumer";
  // Below the floor — not "no demand". A market here may have zero local demand, or real
  // demand too small to clear MIN_DEMAND; the pricing denominator alone cannot tell them
  // apart. Callers that need the distinction cross-check state.demand (see marketRolesByKey).
  return "inert";
}

const STOCKED_ROLES: StockedRole[] = ["exporter", "self-supplier", "consumer"];

/**
 * A market's role, plus the unfloored `state.demand` that fed the classification. Carried
 * alongside the role so a caller can separate a genuinely-empty inert market (demand === 0)
 * from one whose real demand just sits below the MIN_DEMAND pricing floor, without
 * recomputing `toGoodMarketStates` a second time.
 */
export interface MarketRoleInfo {
  role: MarketRole;
  demand: number;
}

/** Every market's role and demand, keyed `systemId|goodId`. One pass over the galaxy. */
export function marketRolesByKey(
  systems: TickSystem[],
  markets: WorldMarket[],
): Map<string, MarketRoleInfo> {
  const rowsBySystem = marketRowsBySystem(markets);
  const demandRateByKey = new Map(markets.map((m) => [`${m.systemId}|${m.goodId}`, m.demandRate]));
  const roles = new Map<string, MarketRoleInfo>();

  for (const s of systems) {
    const rows = rowsBySystem.get(s.id);
    if (!rows) continue;
    const states = toGoodMarketStates({
      buildings: s.buildings, population: s.population, yields: s.yields, markets: rows,
    });
    for (const state of states) {
      const key = `${s.id}|${state.goodId}`;
      const demandRate = demandRateByKey.get(key) ?? 0;
      roles.set(key, { role: classifyMarketRole(state, demandRate), demand: state.demand });
    }
  }
  return roles;
}

/**
 * Every market's warehousing target (`WAREHOUSE_COVER × real demand × anchorMult`), keyed
 * `systemId|goodId` — the figure `classifyMarketState` measures a deficit against. It cannot be
 * read off a market row alone: the row carries only the `MIN_DEMAND`-floored `demandRate`, so the
 * real demand has to come back through `toGoodMarketStates` from the system's population and
 * industry. A market whose system is absent from `systems` gets no entry.
 */
export function logisticsTargetsByKey(
  systems: TickSystem[],
  markets: WorldMarket[],
): Map<string, number> {
  const rowsBySystem = marketRowsBySystem(markets);
  const targets = new Map<string, number>();

  for (const s of systems) {
    const rows = rowsBySystem.get(s.id);
    if (!rows) continue;
    const states = toGoodMarketStates({
      buildings: s.buildings, population: s.population, yields: s.yields, markets: rows,
    });
    for (const state of states) targets.set(`${s.id}|${state.goodId}`, state.logisticsTarget);
  }
  return targets;
}

/**
 * Per good, cover and price split by market role. This is what separates "every producer is
 * drained flat" from "consumers are never served" — a distinction the galaxy-wide median
 * cannot make, because it medians both populations together.
 *
 * `pinnedRoles` holds cohort MEMBERSHIP fixed against a partition measured elsewhere — the
 * baseline arm of an A/B. The classifier reads `state.demand` in its exporter branch, so any
 * change to the demand figure moves membership by construction, and a cover median then moves
 * with the cohort mix rather than with anything about supply. A market the pinned partition
 * never saw (a colony founded after the baseline) is classified live, so the later arm's
 * population is never silently smaller. `countByRole` is the membership table to print per arm.
 *
 * `precomputedRoles` reuses a `marketRolesByKey` pass the caller already ran (the runner builds
 * one to publish the live partition); absent, the pass runs here.
 */
export function computeRoleCoverLevels(
  systems: TickSystem[],
  markets: WorldMarket[],
  pinnedRoles?: ReadonlyMap<string, MarketRole>,
  precomputedRoles?: Map<string, MarketRoleInfo>,
): RoleCoverEntry[] {
  const roles = precomputedRoles ?? marketRolesByKey(systems, markets);

  // A pin that matches nothing is another world's partition (different seed or system count).
  // Proceeding would classify every market live while the report labels itself pinned — the one
  // lie this instrument exists to prevent — so it fails loudly instead.
  if (pinnedRoles && pinnedRoles.size > 0) {
    let matched = 0;
    for (const key of roles.keys()) if (pinnedRoles.has(key)) matched++;
    if (matched === 0) {
      throw new Error(
        `Pinned partition matched 0 of ${roles.size} live markets — the pin file was written ` +
          `by a different world (seed or system count). A pinned report over a live-classified ` +
          `cohort would be a lie; refusing to produce one.`,
      );
    }
  }

  const counts = new Map<string, Record<MarketRole, number>>();
  const covers = new Map<string, Record<StockedRole, number[]>>();
  const consumerEmpty = new Map<string, number>();
  const exporterPrices = new Map<string, number[]>();
  const trulyInertCounts = new Map<string, number>();

  for (const m of markets) {
    const good = GOODS[m.goodId];
    if (!good) continue;
    const key = `${m.systemId}|${m.goodId}`;
    const info = roles.get(key);
    if (!info) continue;
    // `demand` stays live — only the partition is held fixed.
    const role = pinnedRoles?.get(key) ?? info.role;

    let count = counts.get(m.goodId);
    if (!count) {
      count = { exporter: 0, "self-supplier": 0, consumer: 0, inert: 0 };
      counts.set(m.goodId, count);
      covers.set(m.goodId, { exporter: [], "self-supplier": [], consumer: [] });
      consumerEmpty.set(m.goodId, 0);
      exporterPrices.set(m.goodId, []);
      trulyInertCounts.set(m.goodId, 0);
    }
    count[role] += 1;

    if (role === "inert") {
      // Genuinely wanted by nobody, not merely floored — the honest subset of "inert".
      if (info.demand === 0) trulyInertCounts.set(m.goodId, (trulyInertCounts.get(m.goodId) ?? 0) + 1);
      continue;
    }

    const curve = curveForRow(m, good);
    if (curve.targetStock > 0) covers.get(m.goodId)?.[role].push(m.stock / curve.targetStock);

    if (role === "consumer" && nearBandFloor(m, marketBandForRow(m, good))) {
      consumerEmpty.set(m.goodId, (consumerEmpty.get(m.goodId) ?? 0) + 1);
    }
    if (role === "exporter") {
      exporterPrices.get(m.goodId)?.push(midPriceAt(curve, m.stock) / good.basePrice);
    }
  }

  const result: RoleCoverEntry[] = [];
  for (const [goodId, countByRole] of counts) {
    const coverLists = covers.get(goodId);
    const medianCoverByRole: Record<StockedRole, number> = {
      exporter: 0, "self-supplier": 0, consumer: 0,
    };
    for (const role of STOCKED_ROLES) medianCoverByRole[role] = median(coverLists?.[role] ?? []);

    const consumers = countByRole.consumer;
    result.push({
      goodId,
      countByRole,
      medianCoverByRole,
      trulyInertCount: trulyInertCounts.get(goodId) ?? 0,
      // Guarded: a good with no consumer markets reports 0, never NaN.
      consumerEmptyFrac: consumers > 0 ? (consumerEmpty.get(goodId) ?? 0) / consumers : 0,
      exporterMedianPriceRatio: median(exporterPrices.get(goodId) ?? []),
    });
  }
  return result.sort((a, b) => a.goodId.localeCompare(b.goodId));
}

/**
 * Population band edges. Chosen to straddle where the galaxy-wide means were misread — a
 * two-pop frontier rock against a developed homeworld — rather than for round numbers.
 */
const POP_BANDS: { cohort: WorldCohort; below: number }[] = [
  { cohort: "pop <10", below: 10 },
  { cohort: "pop 10-100", below: 100 },
  { cohort: "pop 100-1K", below: 1000 },
  { cohort: "pop >=1K", below: Infinity },
];

/** Order the report renders cohorts in — bands ascending, then the cross-cutting views. */
const COHORT_ORDER: WorldCohort[] = [
  "pop <10", "pop 10-100", "pop 100-1K", "pop >=1K",
  "survival-short", "homeworld", "colony",
];

export function cohortsForSystem(s: TickSystem, homeworldIds: Set<string>): WorldCohort[] {
  const band = POP_BANDS.find((b) => s.population < b.below)?.cohort ?? "pop >=1K";
  const cohorts: WorldCohort[] = [band, homeworldIds.has(s.id) ? "homeworld" : "colony"];
  // No arable slot means no local food production — the physical limit that separates a
  // deprived rock from a world the economy is failing.
  if (s.slotCap.arable <= 0) cohorts.push("survival-short");
  return cohorts;
}

/**
 * Supply and unrest per world cohort. This is what the galaxy-wide mean cannot answer:
 * whether the unrest band grades anything, or whether its boundaries are being crossed by
 * noise in a population that was never comparable in the first place.
 *
 * `startPopulationBySystem` is each system's population at the true run start (tick 0), keyed by
 * system id — the `netGrowthPct` field's denominator. Deliberately NOT `HarnessResults.
 * populationSnapshots` (whose first entry lands at SNAPSHOT_INTERVAL, after the loop has already
 * run — colonies founded in that gap would otherwise misread as present at the start). An empty
 * map means no start reading was taken at all (see `netGrowthPct`'s docstring for the null
 * convention that produces); a system missing from a non-empty map is read as starting at 0,
 * which is what lets a colony founded mid-run show up as growth rather than being excluded from
 * the sum.
 */
export function computeWorldCohorts(
  systems: TickSystem[],
  markets: ReadonlyArray<Pick<WorldMarket, "systemId" | "goodId" | "satisfaction">>,
  homeworldIds: Set<string>,
  strikeThreshold: number,
  events: ReadonlyArray<WorldEvent> = [],
  startPopulationBySystem: ReadonlyMap<string, number> = new Map(),
): WorldCohortEntry[] {
  const states = perSystemSupplyState(systems, markets, events);

  const acc = new Map<WorldCohort, {
    n: number; shortfallSum: number; unrestSum: number; striking: number;
    supplied: number; strained: number; rationing: number; deprived: number; famine: number;
    provisionSum: number; worstGoodSats: number[];
    startPopSum: number; endPopSum: number;
    expectations: number[]; grievances: number[]; staleExpectationCount: number;
  }>();

  for (const s of systems) {
    const state = states.get(s.id);
    if (!state) continue; // unsettled — perSystemSupplyState already filtered it out

    for (const cohort of cohortsForSystem(s, homeworldIds)) {
      let a = acc.get(cohort);
      if (!a) {
        a = {
          n: 0, shortfallSum: 0, unrestSum: 0, striking: 0,
          supplied: 0, strained: 0, rationing: 0, deprived: 0, famine: 0,
          provisionSum: 0, worstGoodSats: [], startPopSum: 0, endPopSum: 0,
          expectations: [], grievances: [], staleExpectationCount: 0,
        };
        acc.set(cohort, a);
      }
      a.n += 1;
      a.shortfallSum += state.d;
      a.unrestSum += s.unrest;
      a.provisionSum += state.provision;
      a.worstGoodSats.push(worstGoodSatisfaction(state));
      // Absent from the start snapshot ⇒ founded during the run ⇒ started at 0, not excluded.
      a.startPopSum += startPopulationBySystem.get(s.id) ?? 0;
      a.endPopSum += s.population;
      if (s.unrest > strikeThreshold) a.striking += 1;
      // A stale (emptyBasket) system's stored memory is a skipped-update artifact, not a current
      // reading — excluded from the distributions and counted instead, exactly like the
      // galaxy-wide fold in summariseSupplyRegimes.
      if (state.emptyBasket) {
        a.staleExpectationCount++;
      } else {
        a.expectations.push(state.expectationStored);
        a.grievances.push(state.grievance);
      }
      // Exhaustive over every member — see population-analysis.ts's summariseSupplyRegimes,
      // which this fold must never diverge from (both read the same perSystemSupplyState map).
      switch (state.regime) {
        case "supplied": a.supplied += 1; break;
        case "strained": a.strained += 1; break;
        case "rationing": a.rationing += 1; break;
        case "deprived": a.deprived += 1; break;
        case "famine": a.famine += 1; break;
        default: {
          const exhaustive: never = state.regime;
          throw new Error(`unhandled supply regime: ${exhaustive}`);
        }
      }
    }
  }

  const noSnapshot = startPopulationBySystem.size === 0;
  const result: WorldCohortEntry[] = [];
  for (const cohort of COHORT_ORDER) {
    const a = acc.get(cohort);
    // A cohort with no members is omitted entirely rather than emitting a divide-by-zero row.
    if (!a || a.n === 0) continue;
    result.push({
      cohort,
      n: a.n,
      meanShortfall: a.shortfallSum / a.n,
      meanUnrest: a.unrestSum / a.n,
      strikingShare: a.striking / a.n,
      suppliedShare: a.supplied / a.n,
      strainedShare: a.strained / a.n,
      rationingShare: a.rationing / a.n,
      deprivedShare: a.deprived / a.n,
      famineShare: a.famine / a.n,
      meanProvision: a.provisionSum / a.n,
      worstGoodMedian: median(a.worstGoodSats),
      // Summed before dividing, never per-system-then-averaged, so a founded colony's start-0
      // contributes fully to the numerator without individually dividing by zero.
      netGrowthPct: noSnapshot ? null : a.startPopSum > 0 ? ((a.endPopSum - a.startPopSum) / a.startPopSum) * 100 : 0,
      expectationLevels: quantileLevels(a.expectations),
      grievanceLevels: quantileLevels(a.grievances),
      staleExpectationCount: a.staleExpectationCount,
    });
  }
  return result;
}

/**
 * Fold the run's accumulated episode costs (`population-analysis.ts`'s `EpisodeCostTotals`) by
 * world cohort — cumulative levels torn down and overshoot deaths are irreversible, and a
 * galaxy-wide total hides which cohort actually pays for them (docs/active/gameplay/economy.md,
 * unrest promise 5 — episode costs are the promise's evidence). Cohorts overlap (see `cohortsForSystem`), so
 * `totalTeardownLevels`/`totalOvershootDeaths` are summed once over the settled galaxy, never as a
 * sum of `byCohort`'s rows.
 */
export function summariseEpisodeCostsByCohort(
  totals: EpisodeCostTotals,
  systems: TickSystem[],
  homeworldIds: Set<string>,
): EpisodeCostSummary {
  const settled = systems.filter((s) => s.control === "developed");

  let totalTeardownLevels = 0;
  for (const levels of totals.teardownBySystem.values()) totalTeardownLevels += levels;
  let totalOvershootDeaths = 0;
  for (const amount of totals.overshootDeathBySystem.values()) totalOvershootDeaths += amount;

  const acc = new Map<WorldCohort, {
    n: number; teardownLevels: number; systemsWithTeardown: number;
    overshootDeaths: number; systemsWithOvershootDeath: number;
  }>();
  for (const s of settled) {
    const teardown = totals.teardownBySystem.get(s.id) ?? 0;
    const overshoot = totals.overshootDeathBySystem.get(s.id) ?? 0;
    for (const cohort of cohortsForSystem(s, homeworldIds)) {
      let a = acc.get(cohort);
      if (!a) {
        a = { n: 0, teardownLevels: 0, systemsWithTeardown: 0, overshootDeaths: 0, systemsWithOvershootDeath: 0 };
        acc.set(cohort, a);
      }
      a.n += 1;
      a.teardownLevels += teardown;
      if (teardown > 0) a.systemsWithTeardown += 1;
      a.overshootDeaths += overshoot;
      if (overshoot > 0) a.systemsWithOvershootDeath += 1;
    }
  }

  const byCohort: EpisodeCostCohortEntry[] = [];
  for (const cohort of COHORT_ORDER) {
    const a = acc.get(cohort);
    if (!a || a.n === 0) continue;
    byCohort.push({ cohort, ...a });
  }
  return { totalTeardownLevels, totalOvershootDeaths, byCohort };
}

/** Quartile bucket (0..3) of `rank` among `n` ranked items — the run's OWN variance distribution,
 *  not a fixed variance scale, so bucket membership stays comparable across arms whatever the
 *  absolute variance level. */
function quartileBucket(rank: number, n: number): number {
  return Math.min(3, Math.floor((rank * 4) / n));
}

/**
 * The ratchet check: bucket each cohort's systems into quartiles of trailing Provision variance
 * (calmest to jitteriest, WITHIN the cohort) and read mean grievance per bucket — the spec's
 * "positive slope = rectifier" test. `varianceBySystem` is
 * `population-analysis.ts`'s `computeTrailingProvisionVariance` output; a system absent from it
 * (too few trailing samples) is excluded from every bucket, not folded into bucket 0.
 */
export function summariseRatchetCheck(
  varianceBySystem: ReadonlyMap<string, number>,
  window: number,
  systems: TickSystem[],
  markets: ReadonlyArray<Pick<WorldMarket, "systemId" | "goodId" | "satisfaction">>,
  homeworldIds: Set<string>,
  events: ReadonlyArray<WorldEvent> = [],
): RatchetCheckSummary {
  const states = perSystemSupplyState(systems, markets, events);
  const settled = systems.filter((s) => s.control === "developed");

  const buckets: RatchetBucketEntry[] = [];
  for (const cohort of COHORT_ORDER) {
    // Rank this cohort's systems by variance ascending — quartiles are computed within the
    // cohort's own membership, so a cohort with too few varianced systems just gets sparse buckets
    // rather than nonsense boundaries.
    const ranked = settled
      .filter((s) => cohortsForSystem(s, homeworldIds).includes(cohort))
      .map((s) => ({ systemId: s.id, variance: varianceBySystem.get(s.id) }))
      .filter((r): r is { systemId: string; variance: number } => r.variance !== undefined)
      .sort((a, b) => a.variance - b.variance);
    if (ranked.length === 0) continue;

    const cells = Array.from({ length: 4 }, () => ({ n: 0, varianceSum: 0, grievanceSum: 0 }));
    ranked.forEach((r, i) => {
      const state = states.get(r.systemId);
      if (!state) return;
      const cell = cells[quartileBucket(i, ranked.length)];
      cell.n += 1;
      cell.varianceSum += r.variance;
      cell.grievanceSum += state.grievance;
    });
    cells.forEach((cell, bucket) => {
      if (cell.n === 0) return; // sparse cohort — omit rather than a divide-by-zero row
      buckets.push({
        cohort, bucket, n: cell.n,
        meanVariance: cell.varianceSum / cell.n,
        meanGrievance: cell.grievanceSum / cell.n,
      });
    });
  }
  return { window, buckets };
}
