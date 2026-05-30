/**
 * Calibration utility (stock-economy PR-3): measure the real economy-type
 * distribution and per-good production-vs-consumption balance across a generated
 * universe. Drives the balance-first production rates (so universe-wide C/P ≈ 1
 * per good) and the calibrated pricing anchors in lib/constants/market-economy.ts.
 *
 * Run: npx tsx scripts/balance-analysis.ts
 */

import { createSimWorld } from "../lib/engine/simulator/world";
import { DEFAULT_SIM_CONSTANTS } from "../lib/engine/simulator/constants";
import { ECONOMY_PRODUCTION, ECONOMY_CONSUMPTION } from "../lib/constants/universe";
import { GOODS } from "../lib/constants/goods";
import type { SimConfig } from "../lib/engine/simulator/types";
import type { EconomyType } from "../lib/types/game";

const ECON_TYPES: EconomyType[] = [
  "agricultural", "extraction", "refinery", "industrial", "tech", "core",
];

// Build a world (no ticks run — we only read the seeded systems/markets).
const config: SimConfig = { seed: 42, tickCount: 0, bots: [] };
const world = createSimWorld(config, DEFAULT_SIM_CONSTANTS);

// 1. Economy-type distribution
const counts: Record<EconomyType, number> = {
  agricultural: 0, extraction: 0, refinery: 0, industrial: 0, tech: 0, core: 0,
};
for (const s of world.systems) counts[s.economyType]++;
const total = world.systems.length;

console.log(`\n=== Economy-type distribution (${total} systems, seed 42) ===`);
for (const e of ECON_TYPES) {
  console.log(`${e.padEnd(14)} ${String(counts[e]).padStart(4)}  (${((counts[e] / total) * 100).toFixed(1)}%)`);
}

// 2. Per-good aggregate production vs consumption capacity (raw rate × #systems).
// C/P > 1 means the universe drains that good (sits below anchor → expensive everywhere).
console.log(`\n=== Per-good raw rate balance (Σ rate × #systems) ===`);
console.log(
  "good".padEnd(12) +
    "prod/tick".padStart(11) +
    "cons/tick".padStart(11) +
    "ratio C/P".padStart(11) +
    "  producers / consumers",
);
console.log("-".repeat(80));

for (const good of Object.keys(GOODS)) {
  let prod = 0;
  let cons = 0;
  const producers: string[] = [];
  const consumers: string[] = [];
  for (const e of ECON_TYPES) {
    const pr = ECONOMY_PRODUCTION[e]?.[good];
    const cr = ECONOMY_CONSUMPTION[e]?.[good];
    if (pr) {
      prod += pr * counts[e];
      producers.push(`${e}:${pr}`);
    }
    if (cr) {
      cons += cr * counts[e];
      consumers.push(`${e}:${cr}`);
    }
  }
  const ratio = prod > 0 ? (cons / prod).toFixed(2) : "inf";
  console.log(
    good.padEnd(12) +
      prod.toFixed(0).padStart(11) +
      cons.toFixed(0).padStart(11) +
      ratio.padStart(11) +
      `   [${producers.join(", ") || "—"}] / [${consumers.join(", ")}]`,
  );
}
