import { describe, it, expect } from "vitest";
import { migrationAttractiveness, migrationFlow } from "../migration";

// jobs weight 0 in the shared consts isolates the contentment/headroom behaviour these
// legacy cases assert; the jobs term gets its own block below. Flow-case destinations
// carry ample labourDemand so the absorptive/source job-caps aren't the binding
// constraint (the cap behaviour is covered explicitly in its own blocks).
const OFF = 100; // employedGradientThreshold above any achievable |gradient| ⇒ staffed migration off
const W = { contentment: 1, headroom: 1, jobs: 0 };
const FLOW = { weights: W, maxOutflowFraction: 0.1, gradientThreshold: 0.01, distanceDecay: 0.1, employedGradientThreshold: OFF, employedLeakFraction: 0 };

describe("migrationAttractiveness", () => {
  it("rises with contentment (low unrest) and with headroom", () => {
    expect(migrationAttractiveness({ unrest: 0, population: 0, popCap: 1000, labourDemand: 0 }, W))
      .toBeGreaterThan(migrationAttractiveness({ unrest: 1, population: 0, popCap: 1000, labourDemand: 0 }, W));
    expect(migrationAttractiveness({ unrest: 0, population: 100, popCap: 1000, labourDemand: 0 }, W))
      .toBeGreaterThan(migrationAttractiveness({ unrest: 0, population: 1000, popCap: 1000, labourDemand: 0 }, W));
  });
  it("popCap=0 does not produce NaN and headroom contributes 0", () => {
    const unrest = 0.3;
    const result = migrationAttractiveness({ unrest, population: 0, popCap: 0, labourDemand: 0 }, W);
    expect(Number.isNaN(result)).toBe(false);
    // headroom = 0 when popCap=0; result = W.contentment * (1 - unrest)
    expect(result).toBeCloseTo(W.contentment * (1 - unrest));
  });
});

describe("migrationAttractiveness — housing overshoot", () => {
  const W = { contentment: 1, headroom: 1, jobs: 0 };
  it("a full system has zero headroom term; an overshot system goes negative (more repulsive)", () => {
    const full = migrationAttractiveness({ unrest: 0, population: 1000, popCap: 1000, labourDemand: 0 }, W);     // headroom term 0
    const over = migrationAttractiveness({ unrest: 0, population: 1500, popCap: 1000, labourDemand: 0 }, W);     // headroom term -0.5
    expect(over).toBeLessThan(full);
    expect(over).toBeCloseTo(1 /*contentment*/ + (-0.5) /*headroom*/, 6);
  });
  it("clamps the headroom term at -1 (>= 2x capacity is maximally repulsive)", () => {
    const at2x = migrationAttractiveness({ unrest: 0, population: 2000, popCap: 1000, labourDemand: 0 }, W);
    const at5x = migrationAttractiveness({ unrest: 0, population: 5000, popCap: 1000, labourDemand: 0 }, W);
    expect(at2x).toBeCloseTo(1 + (-1), 6); // contentment 1 + headroom floor -1 = 0
    expect(at5x).toBeCloseTo(at2x, 6);      // floored, no further drop
  });
});

describe("migrationAttractiveness — jobs term", () => {
  const JW = { contentment: 0, headroom: 0, jobs: 1 }; // isolate the jobs term
  it("a jobbed node (demand > pop) scores above an equal jobless node (demand = 0)", () => {
    const jobbed = migrationAttractiveness({ unrest: 0, population: 100, popCap: 1000, labourDemand: 1000 }, JW);
    const jobless = migrationAttractiveness({ unrest: 0, population: 100, popCap: 1000, labourDemand: 0 }, JW);
    expect(jobbed).toBeGreaterThan(jobless);
  });
  it("flips sign at pop = demand: positive above, zero at, negative below", () => {
    const above = migrationAttractiveness({ unrest: 0, population: 100, popCap: 1000, labourDemand: 200 }, JW);
    const at = migrationAttractiveness({ unrest: 0, population: 100, popCap: 1000, labourDemand: 100 }, JW);
    const below = migrationAttractiveness({ unrest: 0, population: 100, popCap: 1000, labourDemand: 50 }, JW);
    expect(above).toBeGreaterThan(0);
    expect(at).toBeCloseTo(0, 6);
    expect(below).toBeLessThan(0);
  });
  it("demand = pop = 0 yields 0 (no NaN)", () => {
    const r = migrationAttractiveness({ unrest: 0, population: 0, popCap: 1000, labourDemand: 0 }, JW);
    expect(Number.isNaN(r)).toBe(false);
    expect(r).toBeCloseTo(0, 6);
  });
});

describe("migrationAttractiveness — unemployment push is gated on housing fullness (greedy frontier)", () => {
  const JW = { contentment: 0, headroom: 0, jobs: 1 }; // isolate the jobs term

  it("an under-occupied jobless colony is barely penalised, a full one sheds its surplus", () => {
    // Identical jobless state (labourDemand 0), different occupancy: the push scales with fullness, so
    // the empty frontier colony rides its headroom instead of being repelled by its lack of jobs.
    const empty = migrationAttractiveness({ unrest: 0, population: 20, popCap: 1000, labourDemand: 0 }, JW);
    const full = migrationAttractiveness({ unrest: 0, population: 1000, popCap: 1000, labourDemand: 0 }, JW);
    expect(empty).toBeGreaterThan(full);
    expect(empty).toBeCloseTo(-0.02, 2); // −1 push scaled by occupancy 0.02 ⇒ ≈ 0
    expect(full).toBeCloseTo(-1, 6);      // occupancy 1 ⇒ full push
  });

  it("open-jobs pull is unconditional — a roomy job-rich colony still pulls", () => {
    const emptyJobbed = migrationAttractiveness({ unrest: 0, population: 20, popCap: 1000, labourDemand: 500 }, JW);
    expect(emptyJobbed).toBeGreaterThan(0);
  });
});

describe("migrationFlow — drains a calm overshot source", () => {
  const PARAMS = { weights: { contentment: 1, headroom: 1, jobs: 0 }, maxOutflowFraction: 0.1, gradientThreshold: 0.01, distanceDecay: 0.1, employedGradientThreshold: OFF, employedLeakFraction: 0 };
  it("pushes population out of an overshot, CALM source to a roomy calm neighbour", () => {
    // Both unrest 0. Source is overshot (1500/1000), dest is roomy (100/1000) with open jobs.
    const source = { unrest: 0, population: 1500, popCap: 1000, labourDemand: 0 };
    const dest = { unrest: 0, population: 100, popCap: 1000, labourDemand: 1000 };
    const { fromIsA, quantity } = migrationFlow(source, dest, 10, PARAMS);
    expect(fromIsA).toBe(true);     // flows from a(source) to b(dest)
    expect(quantity).toBeGreaterThan(0);
  });
});

describe("migrationFlow", () => {
  it("moves people toward the calmer, roomier neighbour", () => {
    const a = { unrest: 0.9, population: 1000, popCap: 1000, labourDemand: 0 };
    const b = { unrest: 0.0, population: 100, popCap: 1000, labourDemand: 1000 };
    const { fromIsA, quantity } = migrationFlow(a, b, 10, FLOW);
    expect(fromIsA).toBe(true);
    expect(quantity).toBeGreaterThan(0);
  });
  it("caps at the destination's headroom (conserved, no overflow)", () => {
    // dest has ample open jobs (labourDemand 2000) so headroom (5), not the absorptive cap, binds.
    const a = { unrest: 0.9, population: 1000, popCap: 1000, labourDemand: 0 };
    const b = { unrest: 0.0, population: 995, popCap: 1000, labourDemand: 2000 };
    expect(migrationFlow(a, b, 10, FLOW).quantity).toBeLessThanOrEqual(5);
  });
  it("moves less over a costlier jump", () => {
    const a = { unrest: 0.9, population: 1000, popCap: 1000, labourDemand: 0 };
    const b = { unrest: 0.0, population: 100, popCap: 1000, labourDemand: 1000 };
    expect(migrationFlow(a, b, 1, FLOW).quantity).toBeGreaterThan(migrationFlow(a, b, 100, FLOW).quantity);
  });
  it("no flow below the gradient threshold", () => {
    const a = { unrest: 0.5, population: 1000, popCap: 1000, labourDemand: 0 };
    expect(migrationFlow(a, { ...a }, 10, FLOW).quantity).toBe(0);
  });
  it("fromIsA=false when b is less attractive than a", () => {
    // a is calm with headroom + open jobs; b is overcrowded and high-unrest — flow goes b→a
    const a = { unrest: 0, population: 100, popCap: 1000, labourDemand: 1000 };
    const b = { unrest: 0.9, population: 1000, popCap: 1000, labourDemand: 0 };
    const { fromIsA, quantity } = migrationFlow(a, b, 10, FLOW);
    expect(fromIsA).toBe(false);
    expect(quantity).toBeGreaterThan(0);
  });
});

describe("migrationFlow — destination fills housing headroom, not just open jobs", () => {
  const JFLOW = { weights: { contentment: 1, headroom: 1, jobs: 1 }, maxOutflowFraction: 0.1, gradientThreshold: 0.01, distanceDecay: 0.1, employedGradientThreshold: OFF, employedLeakFraction: 0 };
  it("a roomy, job-poor colony absorbs settlers well past its open jobs (housing headroom binds)", () => {
    // The old absorptive cap pinned this at the dest's 200 open jobs; a colony with vast housing
    // headroom now greedily draws settlers AHEAD of jobs — they settle, and their demand pulls the
    // industry that staffs them (housing/pop leads, industry follows). This is the colony-bootstrap fix.
    const source = { unrest: 0.9, population: 5000, popCap: 5000, labourDemand: 0 };   // repulsive, spare 5000
    const dest = { unrest: 0, population: 100, popCap: 10000, labourDemand: 200 };     // 200 open jobs, 9900 housing headroom
    const { fromIsA, quantity } = migrationFlow(source, dest, 10, JFLOW);
    expect(fromIsA).toBe(true);
    expect(quantity).toBeGreaterThan(dest.labourDemand); // fills past open jobs — the greed the old cap forbade
  });
  it("a full destination (no housing headroom) still receives nobody", () => {
    // Housing headroom remains the hard bound: a system at its popCap absorbs no one however hard the
    // source pushes (the attractiveness jobs-push handles the softer 'don't overfill a jobless colony').
    const source = { unrest: 0.9, population: 5000, popCap: 5000, labourDemand: 0 };
    const dest = { unrest: 0, population: 10000, popCap: 10000, labourDemand: 5000 };  // at cap ⇒ headroom 0
    expect(migrationFlow(source, dest, 10, JFLOW).quantity).toBe(0);
  });
});

describe("migrationFlow — source two-tier draw", () => {
  const W3 = { contentment: 1, headroom: 1, jobs: 1 };
  const base = { weights: W3, maxOutflowFraction: 0.1, gradientThreshold: 0.01, distanceDecay: 0.1, employedLeakFraction: 0 };
  // Attractive destination with ample open jobs & housing, so the source-side caps are what's tested.
  const dest = { unrest: 0, population: 100, popCap: 10000, labourDemand: 5000 };

  it("no leak + unreachable threshold: a fully-staffed source sends nobody", () => {
    const source = { unrest: 0.9, population: 1000, popCap: 1000, labourDemand: 1000 }; // spare 0
    const { quantity } = migrationFlow(source, dest, 10, { ...base, employedGradientThreshold: OFF });
    expect(quantity).toBe(0);
  });
  it("employed leak: a fully-staffed source sends a small fraction of its staffed workers", () => {
    // The pop pump — a saturated core (spare 0) still feeds a strongly-attractive colony a trickle.
    const source = { unrest: 0.9, population: 1000, popCap: 1000, labourDemand: 1000 }; // spare 0, fully staffed
    const { fromIsA, quantity } = migrationFlow(source, dest, 10, { ...base, employedGradientThreshold: OFF, employedLeakFraction: 0.02 });
    expect(fromIsA).toBe(true);
    expect(quantity).toBeGreaterThan(0);              // leak flows despite zero spare labour
    expect(quantity).toBeLessThanOrEqual(0.02 * 1000); // bounded by the leaked fraction of the staffed pool
  });
  it("default threshold: a source with idle labour sends up to its spare", () => {
    const source = { unrest: 0.9, population: 1000, popCap: 1000, labourDemand: 600 };  // spare 400
    const { fromIsA, quantity } = migrationFlow(source, dest, 10, { ...base, employedGradientThreshold: OFF });
    expect(fromIsA).toBe(true);
    expect(quantity).toBeGreaterThan(0);
    expect(quantity).toBeLessThanOrEqual(400);
  });
  it("low threshold coaxes staffed workers out once |gradient| clears the bar (the future speed-dial)", () => {
    const source = { unrest: 0.9, population: 1000, popCap: 1000, labourDemand: 1000 }; // spare 0, fully staffed
    const cleared = migrationFlow(source, dest, 10, { ...base, employedGradientThreshold: 0.5 });
    const notCleared = migrationFlow(source, dest, 10, { ...base, employedGradientThreshold: 5 });
    expect(cleared.quantity).toBeGreaterThan(0);   // staffed released
    expect(notCleared.quantity).toBe(0);           // |gradient| below the bar ⇒ staffed stay home
  });
});
