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
