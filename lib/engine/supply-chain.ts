/**
 * Coupled per-system economy tick — the supply-chain cascade engine. Pure
 * (no DB). Tier-1+ production draws its recipe inputs from the system's live
 * local stock; output throttles by the binding input's availability; inputs
 * drain proportional to actual output. Goods are processed in recipe-topological
 * order so a freshly-produced input feeds its consumer the same tick.
 *
 * Only stock ABOVE the floor is drawable, so input draws never breach the
 * [minLevel, maxLevel] band — no re-clamp needed. Civilian consumption, noise,
 * and clamp are identical to the flat tick (lib/engine/tick.ts), whose
 * selfLimitingFactor this engine reuses.
 */
import { clamp } from "@/lib/utils/math";
import {
  selfLimitingFactor,
  type EconomySimParams,
  type MarketTickEntry,
} from "@/lib/engine/tick";
import { GOOD_RECIPES, PRODUCTION_GOOD_ORDER } from "@/lib/constants/recipes";

/** Good → processing rank, derived once from the static recipe-topological order. */
const PRODUCTION_ORDER_INDEX = new Map(PRODUCTION_GOOD_ORDER.map((g, i) => [g, i]));

/**
 * Input-availability throttle in [0, 1] for one producing good. Returns 1 for
 * tier-0 / no-recipe goods and for zero production. Computed against drawable
 * stock (stock − minLevel), so the eventual draw cannot breach the floor.
 */
export function inputGate(
  goodId: string,
  effectiveProduction: number,
  stockOf: (g: string) => number,
  minLevel: number,
): number {
  const recipe = GOOD_RECIPES[goodId];
  if (!recipe || effectiveProduction <= 0) return 1;
  let gate = 1;
  for (const [input, perOutput] of Object.entries(recipe)) {
    const desired = effectiveProduction * perOutput;
    if (desired <= 0) continue;
    const drawable = Math.max(0, stockOf(input) - minLevel);
    const ratio = Math.min(1, drawable / desired);
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
  rng: () => number = Math.random,
): MarketTickEntry[] {
  const { noiseAmplitude, minLevel, maxLevel } = params;

  // Live mutable stock per good for this system.
  const stock = new Map<string, number>();
  for (const e of entries) {
    stock.set(e.goodId, e.stock);
  }
  const stockOf = (g: string): number => stock.get(g) ?? minLevel;

  const processOrder = [...entries].sort(
    (a, b) =>
      (PRODUCTION_ORDER_INDEX.get(a.goodId) ?? Number.MAX_SAFE_INTEGER) -
      (PRODUCTION_ORDER_INDEX.get(b.goodId) ?? Number.MAX_SAFE_INTEGER),
  );

  for (const entry of processOrder) {
    let s = stockOf(entry.goodId);

    const effectiveProduction = (entry.productionRate ?? 0) * (entry.productionMult ?? 1);
    if (effectiveProduction > 0) {
      const gate = inputGate(entry.goodId, effectiveProduction, stockOf, minLevel);
      const ceiling = selfLimitingFactor(s, minLevel, maxLevel, "produce");
      const actualOutput = effectiveProduction * gate * ceiling;
      s += actualOutput;
      // Drain inputs proportional to actual output. Because gate ≤ ratio_i =
      // drawable_i / desiredDraw_i, the actual draw ≤ drawable_i, keeping
      // every input above the floor. The Math.max guard handles floating-point
      // rounding and the same-tick multi-consumer case where a shared input is
      // already drawn down by an earlier consumer.
      const recipe = GOOD_RECIPES[entry.goodId];
      if (recipe) {
        for (const [input, perOutput] of Object.entries(recipe)) {
          const draw = perOutput * actualOutput;
          stock.set(input, Math.max(minLevel, stockOf(input) - draw));
        }
      }
    }

    const effectiveConsumption = (entry.consumptionRate ?? 0) * (entry.consumptionMult ?? 1);
    if (effectiveConsumption > 0) {
      s -= effectiveConsumption * selfLimitingFactor(s, minLevel, maxLevel, "consume");
    }

    const noise = (rng() * 2 - 1) * noiseAmplitude * (entry.volatility ?? 1);
    s = clamp(s + noise, minLevel, maxLevel);
    stock.set(entry.goodId, s);
  }

  return entries.map((e) => ({ ...e, stock: stockOf(e.goodId) }));
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
  rng: () => number = Math.random,
): MarketTickEntry[] {
  const groups = new Map<string, number[]>();
  systemIds.forEach((sysId, i) => {
    (groups.get(sysId) ?? groups.set(sysId, []).get(sysId)!).push(i);
  });

  const result = new Array<MarketTickEntry>(entries.length);
  for (const indices of groups.values()) {
    const simulated = simulateSystemEconomyTick(
      indices.map((i) => entries[i]),
      params,
      rng,
    );
    indices.forEach((i, j) => {
      result[i] = simulated[j];
    });
  }
  return result;
}
