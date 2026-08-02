/**
 * Cohorted harness metrics — the report's supply readings split by which role a market
 * plays for a good, and what kind of world a system is.
 *
 * Every galaxy-wide analyzer beside this one keeps its own definition; this module is
 * additive, so a figure measured against the aggregate stays comparable.
 */

import { MIN_DEMAND } from "@/lib/constants/market-economy";
import { GOODS } from "@/lib/constants/goods";
import { curveForRow, marketBandForRow, midPriceAt } from "@/lib/engine/market-pricing";
import { toGoodMarketStates } from "@/lib/tick/processors/good-market-state";
import { marketRowsBySystem } from "@/lib/world/tick";
import { median } from "@/lib/utils/math";
import { nearBandFloor } from "./market-analysis";
import { perSystemSupplyState } from "./population-analysis";
import type { GoodMarketState } from "@/lib/engine/directed-logistics";
import type { TickSystem } from "@/lib/tick/rows";
import type { WorldEvent, WorldMarket } from "@/lib/world/types";
import type { MarketRole, RoleCoverEntry, StockedRole, WorldCohort, WorldCohortEntry } from "./types";

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
 * Per good, cover and price split by market role. This is what separates "every producer is
 * drained flat" from "consumers are never served" — a distinction the galaxy-wide median
 * cannot make, because it medians both populations together.
 */
export function computeRoleCoverLevels(
  systems: TickSystem[],
  markets: WorldMarket[],
): RoleCoverEntry[] {
  const roles = marketRolesByKey(systems, markets);

  const counts = new Map<string, Record<MarketRole, number>>();
  const covers = new Map<string, Record<StockedRole, number[]>>();
  const consumerEmpty = new Map<string, number>();
  const exporterPrices = new Map<string, number[]>();
  const trulyInertCounts = new Map<string, number>();

  for (const m of markets) {
    const good = GOODS[m.goodId];
    if (!good) continue;
    const info = roles.get(`${m.systemId}|${m.goodId}`);
    if (!info) continue;
    const { role } = info;

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
 */
export function computeWorldCohorts(
  systems: TickSystem[],
  markets: ReadonlyArray<Pick<WorldMarket, "systemId" | "goodId" | "satisfaction">>,
  homeworldIds: Set<string>,
  strikeThreshold: number,
  events: ReadonlyArray<WorldEvent> = [],
): WorldCohortEntry[] {
  const states = perSystemSupplyState(systems, markets, events);

  const acc = new Map<WorldCohort, {
    n: number; dSum: number; unrestSum: number; striking: number;
    supplied: number; rationing: number; shortage: number;
  }>();

  for (const s of systems) {
    const state = states.get(s.id);
    if (!state) continue; // unsettled — perSystemSupplyState already filtered it out

    for (const cohort of cohortsForSystem(s, homeworldIds)) {
      let a = acc.get(cohort);
      if (!a) {
        a = { n: 0, dSum: 0, unrestSum: 0, striking: 0, supplied: 0, rationing: 0, shortage: 0 };
        acc.set(cohort, a);
      }
      a.n += 1;
      a.dSum += state.d;
      a.unrestSum += s.unrest;
      if (s.unrest >= strikeThreshold) a.striking += 1;
      if (state.regime === "supplied") a.supplied += 1;
      else if (state.regime === "rationing") a.rationing += 1;
      else a.shortage += 1;
    }
  }

  const result: WorldCohortEntry[] = [];
  for (const cohort of COHORT_ORDER) {
    const a = acc.get(cohort);
    // A cohort with no members is omitted entirely rather than emitting a divide-by-zero row.
    if (!a || a.n === 0) continue;
    result.push({
      cohort,
      n: a.n,
      meanDissatisfaction: a.dSum / a.n,
      meanUnrest: a.unrestSum / a.n,
      strikingShare: a.striking / a.n,
      suppliedShare: a.supplied / a.n,
      rationingShare: a.rationing / a.n,
      shortageShare: a.shortage / a.n,
    });
  }
  return result;
}
