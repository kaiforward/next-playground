import { describe, it, expect } from "vitest";
import { readExpectation, updateExpectation, type ExpectationParams } from "../expectation";

const PARAMS: ExpectationParams = { floor: 0.5, riseRate: 0.25, resignRate: 0.02 };

describe("updateExpectation (sub-stepped asymmetric EMA)", () => {
  it("converges at the rise rate when Provision is above the stored memory, and at the resign rate when below", () => {
    // P > stored: single sub-step must move by exactly riseRate * gap.
    const rising = updateExpectation(0.2, 0.8, PARAMS, 1);
    expect(rising).toBeCloseTo(0.2 + PARAMS.riseRate * (0.8 - 0.2), 10);

    // P < stored: single sub-step must move by exactly resignRate * gap — a much smaller step.
    const resigning = updateExpectation(0.8, 0.2, PARAMS, 1);
    expect(resigning).toBeCloseTo(0.8 + PARAMS.resignRate * (0.2 - 0.8), 10);

    // Swapping the branch selection (rise <-> resign) fails BOTH of the above: the rising case
    // would move by only 0.02 * 0.6 = 0.012 instead of 0.25 * 0.6 = 0.15, and the resigning case
    // would move by 0.25 * -0.6 = -0.15 instead of 0.02 * -0.6 = -0.012.
    expect(rising).not.toBeCloseTo(0.2 + PARAMS.resignRate * (0.8 - 0.2), 10);
    expect(resigning).not.toBeCloseTo(0.8 + PARAMS.riseRate * (0.2 - 0.8), 10);
  });

  it("sub-steps the unscaled rate rather than scaling it — 4 sub-steps at 0.3 diverge from one step at 4x0.3", () => {
    const stored = 0.1;
    const provision = 0.9;
    const subSteppedParams: ExpectationParams = { floor: 0.5, riseRate: 0.3, resignRate: 0.3 };

    // Correct: 4 iterations of `s <- s + 0.3*(P - s)`, branch re-evaluated (moot here since P
    // stays above s throughout, but the accumulation is what a scaled implementation cannot
    // reproduce because 4x0.3 = 1.2 saturates to a single full jump).
    let expected = stored;
    for (let i = 0; i < 4; i++) expected += 0.3 * (provision - expected);

    const actual = updateExpectation(stored, provision, subSteppedParams, 4);
    expect(actual).toBeCloseTo(expected, 10);

    // A rate-scaled implementation (one step at riseRate * subSteps, clamped into [0,1]) lands
    // exactly on `provision` because 0.3 * 4 = 1.2 saturates — a materially different, and wrong,
    // answer.
    const scaledWrong = stored + Math.min(1, 0.3 * 4) * (provision - stored);
    expect(scaledWrong).toBeCloseTo(provision, 10);
    expect(actual).not.toBeCloseTo(scaledWrong, 6);
  });

  it("is total: any finite stored/provision/subSteps, including out-of-range rates, produce a finite result in [0,1]", () => {
    const extremeParams: ExpectationParams = { floor: 0.5, riseRate: 5, resignRate: 5 };
    const cases: Array<[number, number, number]> = [
      [-5, -3, 1000],
      // Enough sub-steps at an out-of-range rate (5) to overflow if the per-step rate is not
      // clamped into [0,1] — s diverges by a factor of ~4 per step and hits Infinity within
      // ~513 iterations; the NEXT step then computes Infinity + rate*(finite - Infinity), an
      // Infinity-minus-Infinity that IEEE 754 resolves to NaN. A correct implementation clamps
      // each step's rate to 1, so no step ever moves `s` outside [stored, provision] and no
      // overflow is possible.
      [1e10, -1e10, 1000],
      [Number.NaN, 0.4, 3],
      [0.4, Number.NaN, 3],
      [0.4, 0.6, Number.NaN],
      [0.4, 0.6, -7],
      [0, 1, 0],
      [1, 0, 1],
    ];
    for (const [stored, provision, subSteps] of cases) {
      const result = updateExpectation(stored, provision, extremeParams, subSteps);
      expect(Number.isFinite(result)).toBe(true);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(1);
    }
  });
});

describe("readExpectation (validity-guarded seed + floor-at-read)", () => {
  it("treats a stored NaN, -1, and 2 as absent, seeding effective from Provision", () => {
    const provision = 0.7;
    for (const badStored of [Number.NaN, -1, 2]) {
      const { stored, effective } = readExpectation(badStored, provision, PARAMS);
      expect(stored).toBeCloseTo(provision, 10);
      expect(effective).toBeCloseTo(Math.max(provision, PARAMS.floor), 10);
    }
  });

  it("keeps a below-floor stored value verbatim while effective reads the floor", () => {
    const { stored, effective } = readExpectation(0.3, 0.9, PARAMS);
    expect(stored).toBeCloseTo(0.3, 10); // NOT floored — the store stays an honest memory.
    expect(effective).toBeCloseTo(0.5, 10); // The floor, since 0.5 > 0.3.
  });

  it("seeds an absent stored value to Provision, making the same-cycle update a no-op and the newborn's grievance exactly max(0, floor - P)", () => {
    const provision = 0.3; // below the floor, so the newborn still reads floor-pinned grievance.
    const { stored, effective } = readExpectation(undefined, provision, PARAMS);
    expect(stored).toBeCloseTo(provision, 10);

    // Same-cycle update: stored === provision, so every sub-step's (P - stored) term is 0.
    const updated = updateExpectation(stored, provision, PARAMS, 4);
    expect(updated).toBeCloseTo(stored, 10);

    // G = clamp(E - P, 0, 1); since E = max(stored, floor) = max(P, floor), G = max(0, floor - P).
    const grievance = Math.max(0, Math.min(1, effective - provision));
    expect(grievance).toBeCloseTo(Math.max(0, PARAMS.floor - provision), 10);
  });
});
