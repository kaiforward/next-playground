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
import type { GoodMarketState } from "@/lib/engine/directed-logistics";
import type { TickSystem } from "@/lib/tick/rows";
import type { WorldMarket } from "@/lib/world/types";
import type { MarketRole, RoleCoverEntry, StockedRole } from "./types";

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
 * good — so the production tests run first and `inert` means "neither produces nor really
 * demands", a market that is pure pricing-floor artifact.
 */
export function classifyMarketRole(state: GoodMarketState, demandRate: number): MarketRole {
  const production = state.production ?? 0;
  // Mirrors surplusDrawable's own exporter branch, so a market this calls an exporter is
  // exactly one directed logistics would draw from.
  if (production > state.demand && !state.productionSuppressed) return "exporter";
  if (production > 0) return "self-supplier";
  // The floor is assigned from the same constant, not computed, so a floored row lands on
  // it exactly; the epsilon only guards against accumulated float drift in the industrial term.
  if (demandRate > MIN_DEMAND * (1 + 1e-9)) return "consumer";
  return "inert";
}

const STOCKED_ROLES: StockedRole[] = ["exporter", "self-supplier", "consumer"];

/** Every market's role, keyed `systemId|goodId`. One pass over the galaxy. */
export function marketRolesByKey(
  systems: TickSystem[],
  markets: WorldMarket[],
): Map<string, MarketRole> {
  const rowsBySystem = marketRowsBySystem(markets);
  const demandRateByKey = new Map(markets.map((m) => [`${m.systemId}|${m.goodId}`, m.demandRate]));
  const roles = new Map<string, MarketRole>();

  for (const s of systems) {
    const rows = rowsBySystem.get(s.id);
    if (!rows) continue;
    const states = toGoodMarketStates({
      buildings: s.buildings, population: s.population, yields: s.yields, markets: rows,
    });
    for (const state of states) {
      const key = `${s.id}|${state.goodId}`;
      roles.set(key, classifyMarketRole(state, demandRateByKey.get(key) ?? 0));
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

  for (const m of markets) {
    const good = GOODS[m.goodId];
    if (!good) continue;
    const role = roles.get(`${m.systemId}|${m.goodId}`);
    if (!role) continue;

    let count = counts.get(m.goodId);
    if (!count) {
      count = { exporter: 0, "self-supplier": 0, consumer: 0, inert: 0 };
      counts.set(m.goodId, count);
      covers.set(m.goodId, { exporter: [], "self-supplier": [], consumer: [] });
      consumerEmpty.set(m.goodId, 0);
      exporterPrices.set(m.goodId, []);
    }
    count[role] += 1;

    if (role === "inert") continue;

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
      // Guarded: a good with no consumer markets reports 0, never NaN.
      consumerEmptyFrac: consumers > 0 ? (consumerEmpty.get(goodId) ?? 0) / consumers : 0,
      exporterMedianPriceRatio: median(exporterPrices.get(goodId) ?? []),
    });
  }
  return result.sort((a, b) => a.goodId.localeCompare(b.goodId));
}
