/**
 * Coupled per-system economy tick — the supply-chain cascade engine. Pure
 * (no DB). Tier-1+ production draws its recipe inputs from the system's live
 * local stock; output throttles by the binding input's availability; inputs
 * drain proportional to actual output. Goods are processed in recipe-topological
 * order so a freshly-produced input feeds its consumer the same tick.
 *
 * Draws run toward empty on the shared emergency-ration ramp — there
 * is no reserve floor: production decelerates from the anchor to the hold ceiling
 * and stock clamps to [0, maxStock]. Civilian and industrial draws of one good
 * share the ramp at their moment of draw (civilian in the good's own entry pass,
 * industrial when downstream producers process). Because processing is
 * topological, a scarce good rations every drawer at the same consumptionFactor
 * curve. Curve geometry is identical to the flat tick (lib/engine/tick.ts), whose
 * consumptionFactor/productionCeiling this engine reuses.
 */
import { clamp } from "@/lib/utils/math";
import {
  consumptionFactor,
  productionCeiling,
  type EconomySimParams,
  type MarketTickEntry,
} from "@/lib/engine/tick";
import { GOOD_RECIPES, PRODUCTION_GOOD_ORDER } from "@/lib/constants/recipes";

/** Good → processing rank, derived once from the static recipe-topological order. */
const PRODUCTION_ORDER_INDEX = new Map(PRODUCTION_GOOD_ORDER.map((g, i) => [g, i]));

/** A market entry after simulation: post-tick stock plus the flows realized this run. */
export interface SimulatedMarketEntry extends MarketTickEntry {
  /** Output actually produced this run — post input-gate and operating-ceiling. 0 for non-producers. */
  realized: number;
  /** Civilian consumption actually delivered this run (≤ demanded). 0 for non-consumers. */
  delivered: number;
}

/**
 * Per-input draw ratio ∈ [0,1]: the shared scarcity ramp below the input's
 * comfort stock, capped by the stock that physically exists. Above comfort the
 * draw is unconstrained (1); below it every drawer — civilian or industrial —
 * slows at the same consumptionFactor rate at its deterministic point in the
 * recipe-topological draw order instead of being gated behind a reserve floor.
 */
export function inputDrawRatio(stock: number, rationStock: number, desired: number): number {
  if (desired <= 0) return 1;
  const allowed = Math.min(consumptionFactor(stock, rationStock) * desired, Math.max(0, stock));
  return Math.max(0, Math.min(1, allowed / desired));
}

/**
 * Input-availability throttle in [0, 1] for one producing good. Returns 1 for
 * tier-0 / no-recipe goods and for zero production. The binding input's
 * inputDrawRatio gates output; draws run toward empty on the scarcity ramp —
 * there is no reserve floor.
 */
export function inputGate(
  goodId: string,
  effectiveProduction: number,
  stockOf: (g: string) => number,
  rationStockOf: (g: string) => number,
): number {
  const recipe = GOOD_RECIPES[goodId];
  if (!recipe || effectiveProduction <= 0) return 1;
  let gate = 1;
  for (const [input, perOutput] of Object.entries(recipe)) {
    const desired = effectiveProduction * perOutput;
    if (desired <= 0) continue;
    const ratio = inputDrawRatio(stockOf(input), rationStockOf(input), desired);
    if (ratio < gate) gate = ratio;
  }
  return Math.max(0, gate);
}

/**
 * Simulate one system's markets with input-gating. Input order is preserved on
 * return; processing happens in PRODUCTION_GOOD_ORDER so freshly-produced
 * tier-0 outputs feed their tier-1 consumers the same tick. Entries for goods
 * not in the order list are processed last in input order.
 */
export function simulateSystemEconomyTick(
  entries: MarketTickEntry[],
  params: EconomySimParams,
): SimulatedMarketEntry[] {
  const { holdCover, rationCover } = params;

  // Realized (actually produced, post input-gate and operating-ceiling) output
  // per good this run — the production-tax base. Absent good ⇒ produced nothing.
  const realizedByGood = new Map<string, number>();

  // Civilian consumption delivered per good this run — the satisfaction
  // numerator downstream. Absent good ⇒ delivered nothing.
  const deliveredByGood = new Map<string, number>();

  // Per-good emergency ration stock from the authoritative aggregate draw rate.
  const rationMap = new Map<string, number>();
  for (const e of entries) {
    rationMap.set(e.goodId, rationCover * e.demandRate);
  }
  const rationStockOf = (g: string): number => rationMap.get(g) ?? 0;

  // Live mutable stock per good for this system.
  const stock = new Map<string, number>();
  for (const e of entries) {
    stock.set(e.goodId, e.stock);
  }
  // A good with no entry in this system has nothing to draw.
  const stockOf = (g: string): number => stock.get(g) ?? 0;

  const processOrder = [...entries].sort(
    (a, b) =>
      (PRODUCTION_ORDER_INDEX.get(a.goodId) ?? Number.MAX_SAFE_INTEGER) -
      (PRODUCTION_ORDER_INDEX.get(b.goodId) ?? Number.MAX_SAFE_INTEGER),
  );

  for (const entry of processOrder) {
    let s = stockOf(entry.goodId);
    const { maxStock } = entry;

    const effectiveProduction = (entry.productionRate ?? 0) * (entry.productionMult ?? 1);
    if (effectiveProduction > 0) {
      const gate = inputGate(entry.goodId, effectiveProduction, stockOf, rationStockOf);
      const ceiling = productionCeiling(s, entry.targetStock, holdCover);
      const actualOutput = effectiveProduction * gate * ceiling;
      realizedByGood.set(entry.goodId, (realizedByGood.get(entry.goodId) ?? 0) + actualOutput);
      s += actualOutput;
      // Drain inputs proportional to actual output. Because gate ≤ each input's
      // inputDrawRatio (ramp- and availability-capped), the actual draw never
      // exceeds the stock that exists. The Math.max(0, …) guard covers
      // floating-point rounding and the same-tick multi-consumer case where a
      // shared input is already drawn down by an earlier consumer.
      const recipe = GOOD_RECIPES[entry.goodId];
      if (recipe) {
        for (const [input, perOutput] of Object.entries(recipe)) {
          const draw = perOutput * actualOutput;
          stock.set(input, Math.max(0, stockOf(input) - draw));
        }
      }
    }

    const effectiveConsumption = (entry.consumptionRate ?? 0) * (entry.consumptionMult ?? 1);
    if (effectiveConsumption > 0) {
      const factor = consumptionFactor(s, rationCover * entry.demandRate);
      const delivered = Math.min(effectiveConsumption * factor, Math.max(0, s));
      s -= delivered;
      deliveredByGood.set(entry.goodId, delivered);
    }

    s = clamp(s, 0, maxStock);
    stock.set(entry.goodId, s);
  }

  return entries.map((e) => ({
    ...e,
    stock: stockOf(e.goodId),
    realized: realizedByGood.get(e.goodId) ?? 0,
    delivered: deliveredByGood.get(e.goodId) ?? 0,
  }));
}

/**
 * Group a region's flat entries by system, run the coupled per-system tick on
 * each, and return results in the original flat order. `systemIds[i]` owns
 * `entries[i]`. Cross-system coupling is impossible — each system has its own
 * live stock map.
 */
export function simulateCoupledEconomyTick(
  entries: MarketTickEntry[],
  systemIds: string[],
  params: EconomySimParams,
): SimulatedMarketEntry[] {
  const groups = new Map<string, number[]>();
  systemIds.forEach((sysId, i) => {
    (groups.get(sysId) ?? groups.set(sysId, []).get(sysId)!).push(i);
  });

  const result = new Array<SimulatedMarketEntry>(entries.length);
  for (const indices of groups.values()) {
    const simulated = simulateSystemEconomyTick(
      indices.map((i) => entries[i]),
      params,
    );
    indices.forEach((i, j) => {
      result[i] = simulated[j];
    });
  }
  return result;
}
