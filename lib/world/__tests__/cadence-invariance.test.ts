import { describe, it, expect } from "vitest";
import { generateWorld } from "@/lib/world/gen";
import { runWorldTick } from "@/lib/world/tick";
import { goodSatisfactionsBySystem } from "@/lib/tick-harness/good-satisfaction";
import type { DemandBasisSystem } from "@/lib/tick-harness/good-satisfaction";
import { grievanceShortfall, provision } from "@/lib/engine/population";
import { readExpectation } from "@/lib/engine/expectation";
import { EXPECTATION_PARAMS } from "@/lib/constants/population";
import type { TickCadence } from "@/lib/constants/tick-cadence";
import type { World } from "@/lib/world/types";

/**
 * Interval invariance — the whole tick, not just one processor.
 *
 * The three cadence knobs (cycle / construction / logistics) change granularity,
 * never wall-clock rate: every cycle rider scales its per-run flows and per-cycle
 * incomes by `catchUpFactor`, so running the same seed for the same tick span at
 * interval 12 reproduces the interval-24 baseline's rates — population growth and
 * buildings landed.
 *
 * The comparison is statistical, not exact: halving an interval lands the cycles on
 * different ticks, so the two runs draw different RNG streams and `fundQueue`'s
 * non-homogeneous `remaining` term distributes construction differently. With a fixed
 * seed each run is still deterministic (no flake — always passes or always fails on
 * given code), so TOL is a real bar, not a noise band: the honest run-to-run rate
 * difference is ~1.8e-3 (dominated by that fundQueue redistribution), while dropping a
 * processor's `catchUp` diverges an order of magnitude past it — verified by removing
 * the population delta's scaling (cycle12 population 6e-4 → 1.7e-2) and construction's
 * (build12 buildings 1.8e-3 → 8.2e-2). TOL sits between: it catches either break with
 * >3x margin and clears the honest baseline with >2.5x headroom.
 *
 * Logistics is not gated here: at this world size and span it is nearly inert (the
 * budget-bound haul regime barely engages before ~t=456), so `logistics: 12` is
 * identical to baseline on these totals. Logistics interval-invariance is the
 * full-scale harness gate's job (experiments/examples/cadence-invariance-*.yaml),
 * which measures goods hauled per wall-clock — the metric a 60-system CI run can't see.
 *
 * Treasury balance gets its own, looser tolerance, gated on the cycle12 arm ONLY: it
 * inherits the same fundQueue redistribution noise as buildings (construction bills are
 * billed off pendingWork, which forks on the divergent RNG stream), plus its own
 * settlement-boundary rounding as cycles land on different ticks — the honest cycle12
 * baseline is 2.0e-3–3.4e-2 across seeds. TREASURY_TOL sits between: dropping `catchUp`
 * from a single income term (heads tax) diverges cycle12 to ~2.7e-1 — well past
 * TREASURY_TOL — while TREASURY_TOL clears the honest baseline.
 *
 * The build12 arm's treasury total is deliberately NOT gated. At this window the reading
 * measures cycle-phase alignment, not rate: honest cross-seed divergence spans
 * 6.4e-2–4.0e-1 while the construction-billing `catchUp` break lands at ~9.8e-1, so no
 * tolerance both clears honest noise and catches the break. The construction-side
 * `catchUp` seam is gated by the buildings figure on the build12 arm instead.
 */

const SEED = 745878428; // colonies + cycle starts in-window (shared with the ECONOMY_SCALE invariance test)
const SYSTEM_COUNT = 60;
/** Where the STOCK figures are read: 20 reference-cycles — long enough for growth and construction
 *  rates to accumulate, short enough that the arms have not yet diverged on colonisation timing. */
const STATE_TICKS = 480;
/**
 * How far the run goes, and therefore the window the founding FLOW is accumulated over. Founding
 * money is a lumpy era-scale flow, not a smooth rate: it arrives as charter and manifest lumps, the
 * era's whole spend is essentially over by ~5,000 ticks (this fixture: 20,768 of an eventual 20,860
 * banked by 5,760), and an establish takes ~170 construction cycles to complete. A 20-cycle window
 * therefore samples only the ramp's leading edge, where the two arms' lumps land on different ticks
 * and the comparison measures phase rather than rate — measured on this fixture, cycle12 diverges
 * 1.4e-1 at 480 ticks and 2.9e-1 at 1,920, then collapses to 1.2e-3 at 2,880 once the ramp is inside
 * the window, settling at 1.3e-2 by 5,760. The stock figures are NOT read here: the arms genuinely
 * drift apart as colonies complete on different ticks (buildings 7.2e-3, mean expectation 4.9e-2 at
 * 7,680), which is why each figure is read at the window it converges in rather than at one shared
 * end tick.
 */
const FOUNDING_TICKS = 5760;
const TOL = 5e-3;
const TREASURY_TOL = 6e-2; // cycle12 arm only — honest baseline 2.0e-3–3.4e-2 across seeds; see header note
/**
 * Founding money gets its own bar rather than borrowing the treasury balance's. Measured over
 * FOUNDING_TICKS on this fixture's primary seed, the honest cross-arm diff is 3.56e-2 (build12) —
 * cycle12's is far smaller (4.90e-3) because the mis-scaling this arm exists to catch only touches
 * the construction cadence. Reusing TREASURY_TOL is still wrong for the same reason as before: a
 * mis-scaled founding money seam (`spent = plan.cost × share × catchUp` in the directed-build
 * staging path) now drives build12 to 9.35e-2, well past TREASURY_TOL's 6e-2 too.
 *
 * The honest figure grew roughly 3x from the pre-habitability-seeding measurement (1.08e-2 →
 * 3.56e-2): colonisation under the archetype tables is scarcer and its founding-money lumps land
 * less predictably relative to the two cadences, so the phase noise this arm rides is bigger by
 * construction, not a regression. A LONGER window does not recover separation — checked directly
 * (doubling FOUNDING_TICKS to 11,520): the base run's founding expense grows only ~0.4-0.5% past
 * 5,760 (the era genuinely is over by then, confirming the header's premise), while the honest
 * build12 diff drifts up to 3.96e-2 and the broken one to 9.72e-2 — the gap does not open with more
 * ticks, so widening the window buys nothing. The tolerance moves instead: 6e-2 sits between,
 * ~1.7x headroom over the honest baseline, ~1.6x under the break.
 */
const FOUNDING_TOL = 6e-2;
// Adaptive-expectation guard: the memory update sub-steps at catchUpFactor(cadence.cycle) rather
// than rate-scaling (lib/engine/expectation.ts), specifically BECAUSE it is nonlinear
// (branch-switching) and therefore NOT invariant under the relaxation-rate's own scaling trick.
// EXPECTATION_TOL (relative, mirrors TOL's shape) covers mean effective expectation, which sits
// bounded well away from 0 (~0.94-0.95 on this fixture) — measured honest diffs are ~4.7e-3
// (cycle12) / ~6.2e-3 (build12), so 1.5e-2 clears both with ~2.4-3.2x margin. Mean GRIEVANCE is a
// different shape: on this short (20-cycle) fixture nearly every system is newborn or calm, so the
// mean sits near 0 (~1.7e-3 baseline) and a RELATIVE tolerance is unusable — a few-thousandths
// absolute divergence (the same shared-RNG-stream noise every other figure in this file carries)
// reads as an 80%+ relative jump. GRIEVANCE_ABS_TOL is therefore absolute: measured honest diffs are
// ~8.4e-3 (cycle12) / ~1.6e-3 (build12); 0.03 clears both with ≥3.5x margin.
//
// LIMITATION, disclosed rather than silently accepted: this whole-galaxy mean is a CADENCE
// invariance check, not a correctness oracle — like every other figure in this file, it only has
// power against a bug that behaves DIFFERENTLY at different cadences, and only if that difference is
// large relative to this fixture's own cross-arm noise floor. Measured directly (temporarily patching
// the processor to a one-step rate-scaled update — exactly the bug the sub-step rule forbids): at
// this fixture's scale (60 systems, 480 ticks, dominated by newborn colonies whose grievance is ~0 by
// construction) the mutation's effect on these two means was SMALLER than the arms' own honest noise,
// so it would NOT have failed this test. The tight, authoritative guard for the sub-step rule is the
// dedicated single-system fixtures in lib/engine/__tests__/expectation.test.ts ("Sub-stepping is not
// rate-scaling") and lib/tick/processors/__tests__/population.test.ts ("sub-steps the expectation
// update at catchUpFactor(interval), not one scaled step") — both compare against a computed oracle,
// not a cross-arm statistic, and both DO fail on this exact mutation. What this file's extension adds
// on top: a coarse health check that the new distributions stay finite and bounded, and move by a
// comparable amount across every cadence knob, the same bar every other figure here is held to.
const EXPECTATION_TOL = 1.5e-2;
const GRIEVANCE_ABS_TOL = 0.03;

interface RunTotals {
  population: number;
  buildings: number;
  treasuryBalance: number;
  /** Founding money settled over the WHOLE run — a flow, so it must be accumulated, not read off
   *  the last settlement. The settlement clock is not the construction clock, so this is the total
   *  the `build12` arm (construction 12, cycle 24) actually tests for interval invariance. Read over
   *  FOUNDING_TICKS, not STATE_TICKS — see that constant for why the flow needs the longer window. */
  foundingExpense: number;
  /** Mean effective adaptive-expectation memory over settled systems at run end — the sub-step
   *  rule's guard: cycle12 doubles the sub-step count at half the interval, which must reproduce
   *  the baseline's cadence-24 mean, not diverge the way a rate-scaled (non-sub-stepped) update
   *  would. */
  meanExpectation: number;
  /** Mean grievance (`grievanceShortfall`, the same read the unrest fold makes) over settled
   *  systems at run end — reported alongside `meanExpectation` because the sub-step rule's whole
   *  point is what the memory does to the unrest term, not the stored number in isolation. */
  meanGrievance: number;
}

/** Per-settled-system civilian demand basis, folded from the flat `world.buildings` rows the same
 *  way `toTickSystems` does — built here rather than importing the tick-row layer, so this stays a
 *  read of `World` directly, matching the rest of the file. */
function demandBasisBySystem(world: World): Map<string, DemandBasisSystem> {
  const out = new Map<string, DemandBasisSystem>();
  for (const s of world.systems) {
    if (s.control !== "developed") continue;
    out.set(s.id, { buildings: {}, population: s.population });
  }
  for (const b of world.buildings) {
    const entry = out.get(b.systemId);
    if (entry) entry.buildings[b.buildingType] = b.count;
  }
  return out;
}

/** Mean effective expectation and mean grievance over settled systems — computed via the SAME read
 *  the population processor makes (`readExpectation`/`grievanceShortfall`, `lib/engine/`), never
 *  re-derived, so this guard cannot pass by measuring a different quantity than the one the
 *  sub-step rule actually governs. */
function meanExpectationAndGrievance(world: World): { meanExpectation: number; meanGrievance: number } {
  const basis = demandBasisBySystem(world);
  if (basis.size === 0) return { meanExpectation: 0, meanGrievance: 0 };
  const goodsBySystem = goodSatisfactionsBySystem(basis, world.markets);
  let expSum = 0;
  let grvSum = 0;
  let n = 0;
  for (const s of world.systems) {
    if (!basis.has(s.id)) continue;
    const p = provision(goodsBySystem.get(s.id) ?? []);
    const { effective } = readExpectation(s.provisionExpectation, p, EXPECTATION_PARAMS);
    expSum += effective;
    grvSum += grievanceShortfall(effective, p);
    n++;
  }
  return { meanExpectation: expSum / n, meanGrievance: grvSum / n };
}

async function runAtCadence(cadence?: TickCadence): Promise<RunTotals> {
  let world = generateWorld({ systemCount: SYSTEM_COUNT, seed: SEED });
  let foundingExpense = 0;
  const countedSettlement = new Map<string, number>();
  // The world as it stood at STATE_TICKS, kept so the stock figures are read at their own window
  // while the run carries on far enough to accumulate the founding flow. The run is deterministic, so
  // this is byte-identical to what a run that stopped at STATE_TICKS would have ended on.
  let stateWorld: World | null = null;
  for (let t = 0; t < FOUNDING_TICKS; t++) {
    const result = await runWorldTick(world, cadence ? { cadence } : undefined);
    world = result.world;
    for (const treasury of world.treasuries) {
      const s = treasury.lastSettlement;
      if (s === null || countedSettlement.get(treasury.factionId) === s.tick) continue;
      countedSettlement.set(treasury.factionId, s.tick);
      foundingExpense += s.foundingExpense;
    }
    if (t === STATE_TICKS - 1) stateWorld = world;
  }
  if (stateWorld === null) throw new Error("expected the run to pass STATE_TICKS");
  let population = 0;
  for (const s of stateWorld.systems) population += s.population;
  let buildings = 0;
  for (const b of stateWorld.buildings) buildings += Math.max(0, b.count);
  let treasuryBalance = 0;
  for (const t of stateWorld.treasuries) treasuryBalance += t.balance;
  const { meanExpectation, meanGrievance } = meanExpectationAndGrievance(stateWorld);
  return { population, buildings, treasuryBalance, foundingExpense, meanExpectation, meanGrievance };
}

function relDiff(a: number, b: number): number {
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-9);
}

describe("cadence interval invariance", () => {
  it(
    "wall-clock rates match across intervals (each knob turned in isolation)",
    async () => {
      const base = await runAtCadence(undefined); // all 24
      const cycle12 = await runAtCadence({ cycle: 12, construction: 24, logistics: 24 });
      const build12 = await runAtCadence({ cycle: 24, construction: 12, logistics: 24 });

      // The premise of the founding arm below: the base run actually founds something. relDiff(0,0)
      // is 0, so a gate that froze founding galaxy-wide (a missing /economyScale in the valuation
      // seam is exactly that) would sail through the invariance test it exists to catch.
      expect(base.foundingExpense, "base run charged nothing for founding").toBeGreaterThan(0);
      for (const [name, v] of [
        ["cycle12", cycle12],
        ["build12", build12],
      ] as const) {
        const dPop = relDiff(base.population, v.population);
        const dBld = relDiff(base.buildings, v.buildings);
        expect(
          Number.isFinite(v.population) &&
            Number.isFinite(v.buildings) &&
            Number.isFinite(v.treasuryBalance) &&
            Number.isFinite(v.foundingExpense) &&
            Number.isFinite(v.meanExpectation) &&
            Number.isFinite(v.meanGrievance),
          `${name} totals finite`,
        ).toBe(true);
        expect(
          dPop,
          `${name}: population rate diverges — base ${base.population.toFixed(1)} vs ${v.population.toFixed(1)} (rel ${dPop.toExponential(2)})`,
        ).toBeLessThan(TOL);
        expect(
          dBld,
          `${name}: buildings rate diverges — base ${base.buildings} vs ${v.buildings} (rel ${dBld.toExponential(2)})`,
        ).toBeLessThan(TOL);
        // build12's treasury total is phase-dominated at this window and is not gated —
        // see the header's treasury note. Its construction `catchUp` seam is gated by dBld above.
        if (name !== "build12") {
          const dTre = relDiff(base.treasuryBalance, v.treasuryBalance);
          expect(
            dTre,
            `${name}: treasury balance rate diverges — base ${base.treasuryBalance.toFixed(1)} vs ${v.treasuryBalance.toFixed(1)} (rel ${dTre.toExponential(2)})`,
          ).toBeLessThan(TREASURY_TOL);
        }
        const dFnd = relDiff(base.foundingExpense, v.foundingExpense);
        expect(
          dFnd,
          `${name}: founding expense rate diverges — base ${base.foundingExpense.toFixed(1)} vs ${v.foundingExpense.toFixed(1)} (rel ${dFnd.toExponential(2)})`,
        ).toBeLessThan(FOUNDING_TOL);
        // The sub-step rule's guard: cycle12 doubles catchUpFactor(cadence.cycle), so the memory
        // update sub-steps twice as often over half the interval — reproducing the baseline's mean,
        // not diverging the way a rate-scaled (non-sub-stepped) update would. build12 does not touch
        // the cycle cadence at all, so it is a near-zero-diff control on the same assertion.
        const dExp = relDiff(base.meanExpectation, v.meanExpectation);
        expect(
          dExp,
          `${name}: mean expectation diverges — base ${base.meanExpectation.toFixed(4)} vs ${v.meanExpectation.toFixed(4)} (rel ${dExp.toExponential(2)})`,
        ).toBeLessThan(EXPECTATION_TOL);
        // Absolute, not relative — see GRIEVANCE_ABS_TOL's header note.
        const dGrvAbs = Math.abs(base.meanGrievance - v.meanGrievance);
        expect(
          dGrvAbs,
          `${name}: mean grievance diverges — base ${base.meanGrievance.toFixed(4)} vs ${v.meanGrievance.toFixed(4)} (abs diff ${dGrvAbs.toExponential(2)})`,
        ).toBeLessThan(GRIEVANCE_ABS_TOL);
      }
    },
    240_000,
  );
});
