import { describe, it, expect } from "vitest";
import { dissatisfaction, accumulateUnrest, strikeMultiplier, populationDelta } from "../population";

describe("dissatisfaction (convex, demand-weighted)", () => {
  it("is 0 when fully satisfied and 0 when nothing is demanded", () => {
    expect(dissatisfaction([{ satisfaction: 1, demanded: 10 }, { satisfaction: 1, demanded: 2 }])).toBeCloseTo(0, 6);
    expect(dissatisfaction([])).toBe(0);
    expect(dissatisfaction([{ satisfaction: 0, demanded: 0 }])).toBe(0);
  });
  it("weights a high-demand good's deficit far above a low-demand good's (~demand share)", () => {
    const foodCut = dissatisfaction([{ satisfaction: 0, demanded: 18 }, { satisfaction: 1, demanded: 2 }]);
    const luxCut = dissatisfaction([{ satisfaction: 1, demanded: 18 }, { satisfaction: 0, demanded: 2 }]);
    expect(foodCut).toBeGreaterThan(luxCut * 5);
  });
  it("convexity: one deep shortage dominates broad shallow tightness", () => {
    const deep = dissatisfaction([{ satisfaction: 0, demanded: 10 }, { satisfaction: 1, demanded: 90 }]);
    const shallow = dissatisfaction([{ satisfaction: 0.9, demanded: 100 }]);
    expect(deep).toBeGreaterThan(shallow);
  });
});

describe("accumulateUnrest", () => {
  it("rises under sustained dissatisfaction, clamps at 1", () => {
    let u = 0;
    for (let i = 0; i < 1000; i++) u = accumulateUnrest(u, 1, { gain: 0.1, decay: 0.05 });
    expect(u).toBeLessThanOrEqual(1);
    expect(u).toBeGreaterThan(0.5);
  });
  it("decays toward 0 when satisfied; one bad tick is nearly harmless", () => {
    let u = 1;
    for (let i = 0; i < 1000; i++) u = accumulateUnrest(u, 0, { gain: 0.1, decay: 0.05 });
    expect(u).toBeCloseTo(0, 2);
    expect(accumulateUnrest(0, 1, { gain: 0.1, decay: 0.05 })).toBeCloseTo(0.1, 6);
  });
  it("applies gain and decay together from a non-zero state", () => {
    // 0.5 + gain·0.5 − decay·0.5 = 0.5 + 0.05 − 0.025 = 0.525
    expect(accumulateUnrest(0.5, 0.5, { gain: 0.1, decay: 0.05 })).toBeCloseTo(0.525, 6);
  });
});

describe("strikeMultiplier", () => {
  it("is 1 below threshold, ramps smoothly to the floor at unrest = 1", () => {
    expect(strikeMultiplier(0.3, { threshold: 0.5, floorMultiplier: 0.2 })).toBe(1);
    expect(strikeMultiplier(1, { threshold: 0.5, floorMultiplier: 0.2 })).toBeCloseTo(0.2, 6);
    const mid = strikeMultiplier(0.75, { threshold: 0.5, floorMultiplier: 0.2 });
    expect(mid).toBeGreaterThan(0.2);
    expect(mid).toBeLessThan(1);
  });
  it("returns 1 (not NaN) when threshold = 1 — denominator guard", () => {
    // threshold = 1 means "never suppress"; unrest is in [0,1] so unrest <= threshold
    // always holds through normal gameplay, but a raw call with unrest just above 1
    // (e.g. from a pre-clamp intermediate) would produce NaN without the guard.
    const atMax = strikeMultiplier(1, { threshold: 1, floorMultiplier: 0.2 });
    expect(Number.isNaN(atMax)).toBe(false);
    expect(atMax).toBe(1);
    // Directly tests the division-by-zero path: unrest > threshold = 1
    const aboveMax = strikeMultiplier(1.001, { threshold: 1, floorMultiplier: 0.2 });
    expect(Number.isNaN(aboveMax)).toBe(false);
    expect(aboveMax).toBe(1);
  });
});

describe("populationDelta (logistic, gated)", () => {
  const p = { growthRate: 0.02, declineRate: 0.02, overshootDeathRate: 0 };
  it("grows when fed + calm, asymptotes at popCap, declines when starved + unstable", () => {
    expect(populationDelta(500, 1000, 0, 0, p)).toBeGreaterThan(0);
    expect(populationDelta(1000, 1000, 0, 0, p)).toBeCloseTo(0, 6);
    expect(populationDelta(500, 1000, 0.8, 0.9, p)).toBeLessThan(0);
  });
  it("has no growth term when popCap is 0", () => {
    expect(populationDelta(100, 0, 0, 0, p)).toBe(0);
  });
  it("stays at 0 when population is already 0 (both terms scale by population)", () => {
    expect(populationDelta(0, 1000, 0.5, 0.5, p)).toBe(0);
  });
});

describe("populationDelta — housing-overshoot displacement", () => {
  const p = { growthRate: 0.015, declineRate: 0.015, overshootDeathRate: 0.1 };

  it("displaces no one when population ≤ popCap", () => {
    // At/under cap there is no overshoot, so the term is inert.
    expect(populationDelta(1000, 1000, 0, 0, p)).toBeCloseTo(0, 6);
    expect(populationDelta(800, 1000, 0, 0, p)).toBeGreaterThan(0);
  });

  it("removes overshoot as death, scaled by unrest (death-dominant when violent)", () => {
    // pop 1200, popCap 1000 → overshoot 200. headroom 0 (no growth).
    const calm = populationDelta(1200, 1000, 0, 0, p);    // unrest 0 → no displacement, no decline
    const violent = populationDelta(1200, 1000, 0, 1, p);  // unrest 1 → full displacement + decline
    expect(calm).toBeCloseTo(0, 6);
    // decline = 0.015·1200·1 = 18; displacement death = 0.1·200·1 = 20.
    expect(violent).toBeCloseTo(-(18 + 20), 6);
    expect(violent).toBeLessThan(calm);
  });
});
