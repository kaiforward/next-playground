import { describe, it, expect } from "vitest";
import { migrationAttractiveness, migrationFlow } from "../migration";

const W = { contentment: 1, headroom: 1 };
const FLOW = { weights: W, maxOutflowFraction: 0.1, gradientThreshold: 0.01, distanceDecay: 0.1 };

describe("migrationAttractiveness", () => {
  it("rises with contentment (low unrest) and with headroom", () => {
    expect(migrationAttractiveness({ unrest: 0, population: 0, popCap: 1000 }, W))
      .toBeGreaterThan(migrationAttractiveness({ unrest: 1, population: 0, popCap: 1000 }, W));
    expect(migrationAttractiveness({ unrest: 0, population: 100, popCap: 1000 }, W))
      .toBeGreaterThan(migrationAttractiveness({ unrest: 0, population: 1000, popCap: 1000 }, W));
  });
  it("popCap=0 does not produce NaN and headroom contributes 0", () => {
    const unrest = 0.3;
    const result = migrationAttractiveness({ unrest, population: 0, popCap: 0 }, W);
    expect(Number.isNaN(result)).toBe(false);
    // headroom = 0 when popCap=0; result = W.contentment * (1 - unrest)
    expect(result).toBeCloseTo(W.contentment * (1 - unrest));
  });
});

describe("migrationAttractiveness — housing overshoot", () => {
  const W = { contentment: 1, headroom: 1 };
  it("a full system has zero headroom term; an overshot system goes negative (more repulsive)", () => {
    const full = migrationAttractiveness({ unrest: 0, population: 1000, popCap: 1000 }, W);     // headroom term 0
    const over = migrationAttractiveness({ unrest: 0, population: 1500, popCap: 1000 }, W);     // headroom term -0.5
    expect(over).toBeLessThan(full);
    expect(over).toBeCloseTo(1 /*contentment*/ + (-0.5) /*headroom*/, 6);
  });
  it("clamps the headroom term at -1 (>= 2x capacity is maximally repulsive)", () => {
    const at2x = migrationAttractiveness({ unrest: 0, population: 2000, popCap: 1000 }, W);
    const at5x = migrationAttractiveness({ unrest: 0, population: 5000, popCap: 1000 }, W);
    expect(at2x).toBeCloseTo(1 + (-1), 6); // contentment 1 + headroom floor -1 = 0
    expect(at5x).toBeCloseTo(at2x, 6);      // floored, no further drop
  });
});

describe("migrationFlow — drains a calm overshot source", () => {
  const PARAMS = { weights: { contentment: 1, headroom: 1 }, maxOutflowFraction: 0.1, gradientThreshold: 0.01, distanceDecay: 0.1 };
  it("pushes population out of an overshot, CALM source to a roomy calm neighbour", () => {
    // Both unrest 0. Source is overshot (1500/1000), dest is roomy (100/1000).
    const source = { unrest: 0, population: 1500, popCap: 1000 };
    const dest   = { unrest: 0, population: 100,  popCap: 1000 };
    const { fromIsA, quantity } = migrationFlow(source, dest, 10, PARAMS);
    expect(fromIsA).toBe(true);     // flows from a(source) to b(dest)
    expect(quantity).toBeGreaterThan(0);
  });
});

describe("migrationFlow", () => {
  it("moves people toward the calmer, roomier neighbour", () => {
    const a = { unrest: 0.9, population: 1000, popCap: 1000 };
    const b = { unrest: 0.0, population: 100, popCap: 1000 };
    const { fromIsA, quantity } = migrationFlow(a, b, 10, FLOW);
    expect(fromIsA).toBe(true);
    expect(quantity).toBeGreaterThan(0);
  });
  it("caps at the destination's headroom (conserved, no overflow)", () => {
    const a = { unrest: 0.9, population: 1000, popCap: 1000 };
    const b = { unrest: 0.0, population: 995, popCap: 1000 };
    expect(migrationFlow(a, b, 10, FLOW).quantity).toBeLessThanOrEqual(5);
  });
  it("moves less over a costlier jump", () => {
    const a = { unrest: 0.9, population: 1000, popCap: 1000 };
    const b = { unrest: 0.0, population: 100, popCap: 1000 };
    expect(migrationFlow(a, b, 1, FLOW).quantity).toBeGreaterThan(migrationFlow(a, b, 100, FLOW).quantity);
  });
  it("no flow below the gradient threshold", () => {
    const a = { unrest: 0.5, population: 1000, popCap: 1000 };
    expect(migrationFlow(a, { ...a }, 10, FLOW).quantity).toBe(0);
  });
  it("fromIsA=false when b is less attractive than a", () => {
    // a is calm with headroom; b is overcrowded and high-unrest — flow goes b→a
    const a = { unrest: 0, population: 100, popCap: 1000 };
    const b = { unrest: 0.9, population: 1000, popCap: 1000 };
    const { fromIsA, quantity } = migrationFlow(a, b, 10, FLOW);
    expect(fromIsA).toBe(false);
    expect(quantity).toBeGreaterThan(0);
  });
});
