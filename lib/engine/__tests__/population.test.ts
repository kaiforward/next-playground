import { describe, it, expect } from "vitest";
import {
  dissatisfaction,
  accumulateUnrest,
  strikeMultiplier,
  populationDelta,
  crowdFactor,
  crowdingPressure,
  supplyRegime,
  type UnrestParams,
  type PopulationParams,
} from "../population";
import { SHORTAGE_SATISFACTION } from "@/lib/constants/economy";

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

describe("supplyRegime (worst-demanded-good fold)", () => {
  it("is supplied when every demanded good is fully satisfied", () => {
    expect(supplyRegime([{ satisfaction: 1, demanded: 10 }, { satisfaction: 1, demanded: 2 }])).toBe("supplied");
  });
  it("is supplied when nothing is demanded (empty or zero-demand)", () => {
    expect(supplyRegime([])).toBe("supplied");
    expect(supplyRegime([{ satisfaction: 0, demanded: 0 }])).toBe("supplied");
  });
  it("ignores zero-demand goods when folding", () => {
    // A starving zero-demand good must not force a regime — only demanded goods count.
    expect(supplyRegime([{ satisfaction: 0, demanded: 0 }, { satisfaction: 1, demanded: 5 }])).toBe("supplied");
    expect(supplyRegime([{ satisfaction: 0, demanded: 0 }, { satisfaction: 0.8, demanded: 5 }])).toBe("rationing");
  });
  it("is rationing when any demanded good is short of full but none below the shortage line", () => {
    expect(supplyRegime([{ satisfaction: 0.8, demanded: 10 }, { satisfaction: 1, demanded: 2 }])).toBe("rationing");
  });
  it("is shortage when any demanded good is below the shortage line", () => {
    expect(supplyRegime([{ satisfaction: 0.4, demanded: 10 }, { satisfaction: 1, demanded: 2 }])).toBe("shortage");
  });
  it("treats exactly the shortage line as rationing, not shortage (strict <)", () => {
    // satisfaction === SHORTAGE_SATISFACTION is short of full but not below the line.
    expect(supplyRegime([{ satisfaction: SHORTAGE_SATISFACTION, demanded: 10 }])).toBe("rationing");
    expect(supplyRegime([{ satisfaction: SHORTAGE_SATISFACTION - 1e-9, demanded: 10 }])).toBe("shortage");
  });
});

describe("crowdFactor (growth brake)", () => {
  const BRAKE_END = 1.15;
  it("is 1 at or below the cap (r <= 1)", () => {
    expect(crowdFactor(500, 1000, BRAKE_END)).toBe(1);
    expect(crowdFactor(1000, 1000, BRAKE_END)).toBe(1);
  });
  it("is 0 at or above the brake end (r >= brakeEnd)", () => {
    expect(crowdFactor(1150, 1000, BRAKE_END)).toBeCloseTo(0, 6);
    expect(crowdFactor(2000, 1000, BRAKE_END)).toBeCloseTo(0, 6);
  });
  it("is smooth and strictly decreasing between cap and brake end", () => {
    const rs = [1.0, 1.03, 1.06, 1.09, 1.12, 1.15];
    const vals = rs.map((r) => crowdFactor(r * 1000, 1000, BRAKE_END));
    for (let i = 1; i < vals.length; i++) {
      expect(vals[i]).toBeLessThan(vals[i - 1]);
    }
    // Smoothstep midpoint (r = 1.075) sits at 0.5.
    expect(crowdFactor(1075, 1000, BRAKE_END)).toBeCloseTo(0.5, 6);
  });
  it("reads fully crowded (0), not NaN/Infinity, when popCap <= 0", () => {
    expect(crowdFactor(100, 0, BRAKE_END)).toBe(0);
    expect(crowdFactor(100, -50, BRAKE_END)).toBe(0);
    expect(Number.isFinite(crowdFactor(100, 0, BRAKE_END))).toBe(true);
  });
});

describe("crowdingPressure (standing unrest floor from overcrowding)", () => {
  const BRAKE_END = 1.15;
  const MAX = 0.05;
  it("is 0 at or below the cap (r <= 1)", () => {
    expect(crowdingPressure(500, 1000, BRAKE_END, MAX)).toBe(0);
    expect(crowdingPressure(1000, 1000, BRAKE_END, MAX)).toBe(0);
  });
  it("is maxPressure at or above the brake end (r >= brakeEnd)", () => {
    expect(crowdingPressure(1150, 1000, BRAKE_END, MAX)).toBeCloseTo(MAX, 6);
    expect(crowdingPressure(3000, 1000, BRAKE_END, MAX)).toBeCloseTo(MAX, 6);
  });
  it("ramps linearly between cap and brake end", () => {
    // r = 1.075 is the midpoint of [1, 1.15] -> half of maxPressure.
    expect(crowdingPressure(1075, 1000, BRAKE_END, MAX)).toBeCloseTo(MAX / 2, 6);
  });
  it("is maxPressure when popCap <= 0 but population > 0, and 0 when population <= 0", () => {
    expect(crowdingPressure(100, 0, BRAKE_END, MAX)).toBeCloseTo(MAX, 6);
    expect(crowdingPressure(100, -10, BRAKE_END, MAX)).toBeCloseTo(MAX, 6);
    expect(crowdingPressure(0, 0, BRAKE_END, MAX)).toBe(0);
    expect(crowdingPressure(-5, -10, BRAKE_END, MAX)).toBe(0);
  });
});

describe("accumulateUnrest (floor-relaxation integrator)", () => {
  const params: UnrestParams = { gainRationing: 0.06, gainShortage: 0.12, decay: 0.06, recoveryDecay: 0.12 };

  it("settles exactly at the floor from above and below at D = 0, regardless of decay rate", () => {
    // From above, relaxing under both the fast (supplied) and slow (rationing) rates.
    let above = 0.9;
    for (let i = 0; i < 2000; i++) above = accumulateUnrest(above, 0, 0.2, "supplied", params);
    expect(above).toBeCloseTo(0.2, 6);
    let aboveSlow = 0.9;
    for (let i = 0; i < 2000; i++) aboveSlow = accumulateUnrest(aboveSlow, 0, 0.2, "rationing", params);
    expect(aboveSlow).toBeCloseTo(0.2, 6);
    // From below (a highly taxed but well-fed colony rising toward its floor).
    let below = 0.05;
    for (let i = 0; i < 2000; i++) below = accumulateUnrest(below, 0, 0.3, "supplied", params);
    expect(below).toBeCloseTo(0.3, 6);
  });

  it("relaxes supplied excess at recoveryDecay and rationing excess at decay (geometric over two steps)", () => {
    const floor = 0.2;
    const start = 0.6;
    // Supplied: excess shrinks by (1 - recoveryDecay) each step.
    const s1 = accumulateUnrest(start, 0, floor, "supplied", params);
    const s2 = accumulateUnrest(s1, 0, floor, "supplied", params);
    expect((s2 - floor) / (start - floor)).toBeCloseTo((1 - params.recoveryDecay) ** 2, 6);
    // Rationing: excess shrinks by the slower (1 - decay) each step.
    const r1 = accumulateUnrest(start, 0, floor, "rationing", params);
    const r2 = accumulateUnrest(r1, 0, floor, "rationing", params);
    expect((r2 - floor) / (start - floor)).toBeCloseTo((1 - params.decay) ** 2, 6);
    // Supplied recovers faster than rationing over the same excess.
    expect(s2).toBeLessThan(r2);
  });

  it("accumulates faster under shortage than under shallow rationing at equal D", () => {
    const rationing = accumulateUnrest(0.2, 0.5, 0.2, "rationing", params);
    const shortage = accumulateUnrest(0.2, 0.5, 0.2, "shortage", params);
    expect(shortage).toBeGreaterThan(rationing);
  });

  it("is monotonic across the regime boundary — worse regime at equal D never lowers next unrest", () => {
    const u = 0.5;
    const floor = 0.2;
    const d = 0.5;
    const supplied = accumulateUnrest(u, d, floor, "supplied", params);
    const rationing = accumulateUnrest(u, d, floor, "rationing", params);
    const shortage = accumulateUnrest(u, d, floor, "shortage", params);
    expect(rationing).toBeGreaterThanOrEqual(supplied);
    expect(shortage).toBeGreaterThanOrEqual(rationing);
  });

  it("keeps one full-shortage pulse from floor 0.23 below the 0.65 strike threshold", () => {
    // catchUpFactor = 2 is applied by the processor; the engine receives pre-scaled gains.
    const scaled: UnrestParams = {
      gainRationing: 0.06 * 2,
      gainShortage: 0.12 * 2,
      decay: 0.06 * 2,
      recoveryDecay: 0.12 * 2,
    };
    const next = accumulateUnrest(0.23, 1, 0.23, "shortage", scaled);
    expect(next).toBeGreaterThan(0.23); // it rose
    expect(next).toBeLessThan(0.65); // but is recoverable, not an instant strike
  });

  it("clamps output to [0,1]", () => {
    const big: UnrestParams = { gainRationing: 5, gainShortage: 5, decay: 0.06, recoveryDecay: 0.12 };
    expect(accumulateUnrest(1, 1, 0.9, "shortage", big)).toBe(1);
    expect(accumulateUnrest(0, 0, 0, "supplied", params)).toBe(0);
  });

  it("clamps k so a catch-up-scaled decay can never overshoot below the floor", () => {
    // A large catch-up can scale the decay past 1; without clamping k the relaxation
    // term would flip sign and push unrest below its standing floor.
    const overScaled: UnrestParams = { gainRationing: 0, gainShortage: 0, decay: 1.5, recoveryDecay: 1.5 };
    const next = accumulateUnrest(0.5, 0, 0.2, "supplied", overScaled);
    expect(next).toBe(0.2); // k clamps to 1 -> lands exactly on the floor, no overshoot
    expect(next).toBeGreaterThanOrEqual(0.2);
    // A realistic catch-up = 2 relaxes toward the floor from above without crossing it.
    const scaled: UnrestParams = { gainRationing: 0, gainShortage: 0, decay: 0.06 * 2, recoveryDecay: 0.12 * 2 };
    const step = accumulateUnrest(0.5, 0, 0.2, "supplied", scaled);
    expect(step).toBeGreaterThan(0.2);
    expect(step).toBeLessThan(0.5);
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

describe("populationDelta (crowd-braked growth, gated overshoot death)", () => {
  const p: PopulationParams = {
    growthRate: 0.02,
    declineRate: 0.02,
    overshootDeathRate: 0,
    crowdBrakeEnd: 1.15,
    overshootDeathUnrestGate: 0.65,
  };

  it("grows at full rate right up against the cap (r = 0.99), unlike the old logistic", () => {
    // Old logistic headroom (1 - 0.99) throttled growth to ~1% here; the crowd brake keeps it full.
    const delta = populationDelta(990, 1000, 0, 0, p);
    expect(delta).toBeCloseTo(p.growthRate * 990, 6); // full rate, ~19.8
    expect(delta).toBeGreaterThan(1); // old logistic would give ~0.198
  });

  it("still grows at full rate at exactly the cap (r = 1)", () => {
    expect(populationDelta(1000, 1000, 0, 0, p)).toBeCloseTo(p.growthRate * 1000, 6);
  });

  it("has zero growth at or beyond the brake end (r >= 1.15)", () => {
    expect(populationDelta(1150, 1000, 0, 0, p)).toBeCloseTo(0, 6);
    expect(populationDelta(1200, 1000, 0, 0, p)).toBeCloseTo(0, 6);
  });

  it("declines with unrest exactly as before (growth suppressed by full dissatisfaction)", () => {
    // D = 1 zeroes growth, isolating the unchanged decline term: declineRate * pop * unrest.
    expect(populationDelta(500, 1000, 1, 0.5, p)).toBeCloseTo(-(p.declineRate * 500 * 0.5), 6);
  });

  it("has no growth term when popCap is 0", () => {
    expect(populationDelta(100, 0, 0, 0, p)).toBe(0);
  });

  it("stays at 0 when population is already 0", () => {
    expect(populationDelta(0, 1000, 0.5, 0.5, p)).toBe(0);
  });
});

describe("populationDelta — gated overshoot death", () => {
  // Isolate the overshoot-death term: no growth, no decline.
  const deathOnly: PopulationParams = {
    growthRate: 0,
    declineRate: 0,
    overshootDeathRate: 0.1,
    crowdBrakeEnd: 1.15,
    overshootDeathUnrestGate: 0.65,
  };

  it("displaces no one at or under the cap regardless of unrest", () => {
    expect(populationDelta(1000, 1000, 0, 1, deathOnly)).toBeCloseTo(0, 6);
    expect(populationDelta(800, 1000, 0, 1, deathOnly)).toBeCloseTo(0, 6);
  });

  it("does not fire at or below the unrest gate (0.65)", () => {
    expect(populationDelta(1200, 1000, 0, 0.65, deathOnly)).toBeCloseTo(0, 6);
    expect(populationDelta(1200, 1000, 0, 0.5, deathOnly)).toBeCloseTo(0, 6);
  });

  it("fires above the unrest gate, scaled by overshoot and unrest", () => {
    // overshoot = 200, unrest 0.7 -> death = 0.1 * 200 * 0.7 = 14.
    const delta = populationDelta(1200, 1000, 0, 0.7, deathOnly);
    expect(delta).toBeCloseTo(-14, 6);
    expect(delta).toBeLessThan(0);
  });

  it("is death-dominant in a violent collapse (death plus decline)", () => {
    const violent: PopulationParams = {
      growthRate: 0.015,
      declineRate: 0.015,
      overshootDeathRate: 0.1,
      crowdBrakeEnd: 1.15,
      overshootDeathUnrestGate: 0.65,
    };
    // pop 1200, cap 1000: growth 0 (r > brakeEnd), decline 0.015*1200*1 = 18, death 0.1*200*1 = 20.
    expect(populationDelta(1200, 1000, 0, 1, violent)).toBeCloseTo(-(18 + 20), 6);
  });
});
