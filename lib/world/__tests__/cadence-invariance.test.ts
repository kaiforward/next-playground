import { describe, it, expect } from "vitest";
import { generateWorld } from "@/lib/world/gen";
import { runWorldTick } from "@/lib/world/tick";
import type { TickCadence } from "@/lib/constants/tick-cadence";

/**
 * Interval invariance — the whole tick, not just one processor.
 *
 * The three cadence knobs (month / construction / logistics) change granularity,
 * never wall-clock rate: every pulse rider scales its per-run flows and per-pulse
 * incomes by `catchUpFactor`, so running the same seed for the same tick span at
 * interval 12 reproduces the interval-24 baseline's rates — population growth and
 * buildings landed.
 *
 * The comparison is statistical, not exact: halving an interval lands the pulses on
 * different ticks, so the two runs draw different RNG streams and `fundQueue`'s
 * non-homogeneous `remaining` term distributes construction differently. With a fixed
 * seed each run is still deterministic (no flake — always passes or always fails on
 * given code), so TOL is a real bar, not a noise band: the honest run-to-run rate
 * difference is ~1.8e-3 (dominated by that fundQueue redistribution), while dropping a
 * processor's `catchUp` diverges an order of magnitude past it — verified by removing
 * the population delta's scaling (month12 population 6e-4 → 1.7e-2) and construction's
 * (build12 buildings 1.8e-3 → 8.2e-2). TOL sits between: it catches either break with
 * >3x margin and clears the honest baseline with >2.5x headroom.
 *
 * Logistics is not gated here: at this world size and span it is nearly inert (the
 * budget-bound haul regime barely engages before ~t=456), so `logistics: 12` is
 * identical to baseline on these totals. Logistics interval-invariance is the
 * full-scale harness gate's job (experiments/examples/cadence-invariance-*.yaml),
 * which measures goods hauled per wall-clock — the metric a 60-system CI run can't see.
 */

const SEED = 745878428; // colonies + monthly pulses in-window (shared with the ECONOMY_SCALE invariance test)
const SYSTEM_COUNT = 60;
const TICKS = 480; // 20 reference-months — long enough for growth and construction rates to accumulate
const TOL = 5e-3;

interface RunTotals {
  population: number;
  buildings: number;
}

async function runAtCadence(cadence?: TickCadence): Promise<RunTotals> {
  let world = generateWorld({ systemCount: SYSTEM_COUNT, seed: SEED });
  for (let t = 0; t < TICKS; t++) {
    const result = await runWorldTick(world, cadence ? { cadence } : undefined);
    world = result.world;
  }
  let population = 0;
  for (const s of world.systems) population += s.population;
  let buildings = 0;
  for (const b of world.buildings) buildings += Math.max(0, b.count);
  return { population, buildings };
}

function relDiff(a: number, b: number): number {
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-9);
}

describe("cadence interval invariance", () => {
  it(
    "wall-clock rates match across intervals (each knob turned in isolation)",
    async () => {
      const base = await runAtCadence(undefined); // all 24
      const month12 = await runAtCadence({ month: 12, construction: 24, logistics: 24 });
      const build12 = await runAtCadence({ month: 24, construction: 12, logistics: 24 });

      for (const [name, v] of [
        ["month12", month12],
        ["build12", build12],
      ] as const) {
        const dPop = relDiff(base.population, v.population);
        const dBld = relDiff(base.buildings, v.buildings);
        expect(Number.isFinite(v.population) && Number.isFinite(v.buildings), `${name} totals finite`).toBe(true);
        expect(
          dPop,
          `${name}: population rate diverges — base ${base.population.toFixed(1)} vs ${v.population.toFixed(1)} (rel ${dPop.toExponential(2)})`,
        ).toBeLessThan(TOL);
        expect(
          dBld,
          `${name}: buildings rate diverges — base ${base.buildings} vs ${v.buildings} (rel ${dBld.toExponential(2)})`,
        ).toBeLessThan(TOL);
      }
    },
    120_000,
  );
});
