import { describe, it, expect } from "vitest";
import {
  dissatisfaction,
  provision,
  worstDemandedGoods,
  accumulateUnrest,
  strikeMultiplier,
  populationDelta,
  crowdFactor,
  crowdingPressure,
  foldSupplyState,
  unrestSlope,
  type UnrestParams,
  type PopulationParams,
  type SupplyRegime,
  type SupplyState,
} from "../population";
import { SHORTAGE_SATISFACTION, D_SHORTAGE_CUT } from "@/lib/constants/economy";
import { GOOD_NECESSITY } from "@/lib/constants/physical-economy";

describe("dissatisfaction (complement of provision, necessity-weighted)", () => {
  it("is 0 when fully satisfied and 0 when nothing is demanded", () => {
    expect(dissatisfaction([
      { goodId: "food", satisfaction: 1, demanded: 10 },
      { goodId: "luxuries", satisfaction: 1, demanded: 2 },
    ])).toBeCloseTo(0, 6);
    expect(dissatisfaction([])).toBe(0);
    expect(dissatisfaction([{ goodId: "food", satisfaction: 0, demanded: 0 }])).toBe(0);
  });

  it("ranks by necessity, not by how much is bought", () => {
    // Equal demand, opposite necessity: the medicine shortfall must dominate the luxuries one even
    // though the basket wants exactly as much of each. Demand-share alone cannot express this.
    const medicineCut = dissatisfaction([
      { goodId: "medicine", satisfaction: 0, demanded: 10 },
      { goodId: "luxuries", satisfaction: 1, demanded: 10 },
    ]);
    const luxCut = dissatisfaction([
      { goodId: "medicine", satisfaction: 1, demanded: 10 },
      { goodId: "luxuries", satisfaction: 0, demanded: 10 },
    ]);
    expect(medicineCut).toBeGreaterThan(luxCut * 5);
  });

  it("still weights by how much is wanted, at equal necessity", () => {
    const deep = dissatisfaction([
      { goodId: "water", satisfaction: 0, demanded: 90 },
      { goodId: "food", satisfaction: 1, demanded: 10 },
    ]);
    const shallow = dissatisfaction([
      { goodId: "water", satisfaction: 1, demanded: 90 },
      { goodId: "food", satisfaction: 0, demanded: 10 },
    ]);
    expect(deep).toBeGreaterThan(shallow);
  });

  it("is the exact complement of provision() on every basket, including the empty one", () => {
    // One implementation, two names — pop-needs.ts:9-11's whole reason to exist is to stop the
    // display twin re-implementing this sum and drifting from it. If dissatisfaction() were ever
    // re-implemented as its own sum instead of 1 − provision(), this is the test that catches it.
    const baskets: { goodId: string; satisfaction: number; demanded: number }[][] = [
      [],
      [
        { goodId: "water", satisfaction: 1, demanded: 10 },
        { goodId: "luxuries", satisfaction: 1, demanded: 2 },
      ],
      [
        { goodId: "water", satisfaction: 0, demanded: 10 },
        { goodId: "food", satisfaction: 0, demanded: 10 },
      ],
      [
        { goodId: "water", satisfaction: 0.8, demanded: 10 },
        { goodId: "food", satisfaction: 0.8, demanded: 30 },
        { goodId: "medicine", satisfaction: 0.8, demanded: 5 },
      ],
    ];
    for (const basket of baskets) {
      expect(dissatisfaction(basket)).toBeCloseTo(1 - provision(basket), 10);
    }
  });

  it("reads a uniform partial shortfall as its own size, not its square (the spec's compression table)", () => {
    // A 17% uniform shortfall folds to ~0.17 under the un-squared fold, against the old squared
    // fold's ~0.029 (0.17² ≈ 0.0289). A scenario built the way band-constants.test.ts's dFor() builds
    // them (every named good at satisfaction 0, gap always exactly 1) cannot see this at all: 1² = 1
    // either way. This basket needs a genuine partial gap.
    const seventeenPercent = [
      { goodId: "water", satisfaction: 0.83, demanded: 10 },
      { goodId: "food", satisfaction: 0.83, demanded: 30 },
      { goodId: "medicine", satisfaction: 0.83, demanded: 5 },
    ];
    expect(dissatisfaction(seventeenPercent)).toBeCloseTo(0.17, 2);

    // Restated from the shipped "still weights by how much is wanted" family at an exact 20%
    // shortfall: it used to fold to 0.04 (0.2²) and now reads 0.2 directly.
    const twentyPercent = [
      { goodId: "water", satisfaction: 0.8, demanded: 10 },
      { goodId: "food", satisfaction: 0.8, demanded: 30 },
      { goodId: "medicine", satisfaction: 0.8, demanded: 5 },
    ];
    expect(dissatisfaction(twentyPercent)).toBeCloseTo(0.2, 10);
  });

  it("is exactly linear, not convex: redistributing the same total weighted gap reads identically", () => {
    // Before this change, a deep shortage in a small slice of the basket dominated a broad shallow
    // one at the same total weighted gap (0.1 vs 0.01 under the squared fold — see the git history of
    // this test). The un-squared fold IS the weighted mean, so it cannot tell the two distributions
    // apart; this fails against the squared fold.
    const deep = dissatisfaction([
      { goodId: "water", satisfaction: 0, demanded: 10 },
      { goodId: "water", satisfaction: 1, demanded: 90 },
    ]);
    const shallow = dissatisfaction([{ goodId: "water", satisfaction: 0.9, demanded: 100 }]);
    expect(deep).toBeCloseTo(shallow, 10);
    expect(deep).toBeCloseTo(0.1, 10);
  });

  it("ignores a good with no authored necessity rather than guessing one", () => {
    // Totality is enforced by a constants test; at runtime an unknown id must not invent a weight.
    expect(dissatisfaction([
      { goodId: "not_a_good", satisfaction: 0, demanded: 100 },
      { goodId: "water", satisfaction: 1, demanded: 10 },
    ])).toBe(0);
  });
});

describe("provision (necessity-and-demand-weighted mean)", () => {
  it("reads 1 for an empty basket and a fully-delivered basket, 0 for a weighted basket at zero satisfaction", () => {
    expect(provision([])).toBe(1);
    expect(provision([
      { goodId: "water", satisfaction: 1, demanded: 10 },
      { goodId: "luxuries", satisfaction: 1, demanded: 2 },
    ])).toBeCloseTo(1, 10);
    expect(provision([
      { goodId: "water", satisfaction: 0, demanded: 10 },
      { goodId: "food", satisfaction: 0, demanded: 5 },
    ])).toBe(0);
  });

  it("is unmoved by a good with zero demand, or zero necessity", () => {
    const base = [
      { goodId: "water", satisfaction: 0.4, demanded: 10 },
      { goodId: "food", satisfaction: 0.9, demanded: 5 },
    ];
    const withZeroDemand = [...base, { goodId: "medicine", satisfaction: 0, demanded: 0 }];
    const withZeroNecessity = [...base, { goodId: "not_a_good", satisfaction: 0, demanded: 100 }];
    expect(provision(withZeroDemand)).toBeCloseTo(provision(base), 10);
    expect(provision(withZeroNecessity)).toBeCloseTo(provision(base), 10);
  });

  it("clamps non-finite or out-of-range satisfaction rather than propagating it", () => {
    const nanGoods = [
      { goodId: "water", satisfaction: NaN, demanded: 10 },
      { goodId: "food", satisfaction: 1, demanded: 10 },
    ];
    expect(Number.isNaN(provision(nanGoods))).toBe(false);
    expect(provision(nanGoods)).toBeCloseTo(0.5, 10); // NaN clamps to 0, averaged with a full 1

    const outOfRange = [
      { goodId: "water", satisfaction: 1.5, demanded: 10 },
      { goodId: "food", satisfaction: -3, demanded: 10 },
    ];
    expect(provision(outOfRange)).toBeCloseTo(0.5, 10); // 1.5 clamps to 1, -3 clamps to 0

    const infinities = [
      { goodId: "water", satisfaction: Infinity, demanded: 10 },
      { goodId: "food", satisfaction: -Infinity, demanded: 10 },
    ];
    expect(Number.isFinite(provision(infinities))).toBe(true);
    expect(provision(infinities)).toBeCloseTo(0.5, 10);
  });
});

describe("worstDemandedGoods (ascending tail with demand share)", () => {
  it("returns the demanded good(s) with lowest satisfaction, ascending — a naive min scan", () => {
    const goods = [
      { goodId: "water", satisfaction: 0.6, demanded: 10 },
      { goodId: "food", satisfaction: 0.2, demanded: 10 },
      { goodId: "medicine", satisfaction: 0.9, demanded: 10 },
    ];
    expect(worstDemandedGoods(goods, 2).map((r) => r.goodId)).toEqual(["food", "water"]);
  });

  it("breaks a satisfaction tie by descending demand share", () => {
    const goods = [
      { goodId: "water", satisfaction: 0.3, demanded: 10 },
      { goodId: "food", satisfaction: 0.3, demanded: 90 }, // tied on satisfaction, bigger demand share
      { goodId: "medicine", satisfaction: 0.9, demanded: 100 },
    ];
    const worst = worstDemandedGoods(goods, 2);
    expect(worst.map((r) => r.goodId)).toEqual(["food", "water"]);
  });

  it("returns fewer than count when the world demands fewer goods, dropping demanded<=0 goods entirely", () => {
    const goods = [
      { goodId: "water", satisfaction: 0.5, demanded: 10 },
      { goodId: "food", satisfaction: 0.9, demanded: 0 }, // not demanded — not a reading
      { goodId: "medicine", satisfaction: 0.1, demanded: -5 }, // negative demand — not a reading
    ];
    const worst = worstDemandedGoods(goods, 5);
    expect(worst).toHaveLength(1);
    expect(worst[0].goodId).toBe("water");
  });

  it("demandShare sums to 1 over the world's demanded goods and moves only with demand", () => {
    const goods = [
      { goodId: "water", satisfaction: 0.5, demanded: 90 },
      { goodId: "food", satisfaction: 0.5, demanded: 9 },
      { goodId: "medicine", satisfaction: 0.5, demanded: 1 }, // epsilon demand, high necessity
    ];
    const all = worstDemandedGoods(goods, goods.length);
    const totalShare = all.reduce((sum, r) => sum + r.demandShare, 0);
    expect(totalShare).toBeCloseTo(1, 10);
    const medicine = all.find((r) => r.goodId === "medicine");
    expect(medicine).toBeDefined();
    expect(medicine?.necessity).toBeCloseTo(GOOD_NECESSITY.medicine, 10);
    expect(medicine?.demandShare).toBeCloseTo(0.01, 10); // 1 / (90 + 9 + 1)
  });

  it("keeps a zero-necessity, positive-demand good tail-eligible with its demand-only share", () => {
    // demandShare is deliberately NOT necessity-weighted, and only demanded <= 0 excludes a good from
    // being a reading at all — an unauthored (necessity 0) good with real demand must still be able to
    // be "the worst demanded good", carrying necessity: 0 rather than being silently dropped.
    const goods = [
      { goodId: "not_a_good", satisfaction: 0.1, demanded: 40 }, // necessity 0, worst satisfaction
      { goodId: "water", satisfaction: 0.9, demanded: 60 },
    ];
    const worst = worstDemandedGoods(goods, 2);
    const zeroNecessity = worst.find((r) => r.goodId === "not_a_good");
    expect(zeroNecessity).toBeDefined();
    expect(zeroNecessity?.necessity).toBe(0);
    expect(zeroNecessity?.demandShare).toBeCloseTo(0.4, 10); // 40 / (40 + 60), demand-only
    expect(worst[0].goodId).toBe("not_a_good"); // worst satisfaction still ranks first
  });

  it("clamps non-finite or out-of-range satisfaction in the reading instead of propagating it", () => {
    const nan = worstDemandedGoods([{ goodId: "water", satisfaction: NaN, demanded: 10 }], 1);
    expect(nan[0].satisfaction).toBe(0);

    const outOfRange = worstDemandedGoods(
      [
        { goodId: "water", satisfaction: 1.5, demanded: 10 },
        { goodId: "food", satisfaction: -3, demanded: 10 },
      ],
      2,
    );
    const water = outOfRange.find((r) => r.goodId === "water");
    const food = outOfRange.find((r) => r.goodId === "food");
    expect(water?.satisfaction).toBe(1);
    expect(food?.satisfaction).toBe(0);

    const infinities = worstDemandedGoods(
      [
        { goodId: "water", satisfaction: Infinity, demanded: 10 },
        { goodId: "food", satisfaction: -Infinity, demanded: 10 },
      ],
      2,
    );
    for (const r of infinities) expect(Number.isFinite(r.satisfaction)).toBe(true);
    expect(infinities.find((r) => r.goodId === "water")?.satisfaction).toBe(1);
    expect(infinities.find((r) => r.goodId === "food")?.satisfaction).toBe(0);
  });

  it("returns an empty tail rather than throwing or padding when count <= 0", () => {
    // Five entries so a negative count that only guards via Array.slice's own negative-index
    // behaviour (rather than clamping count itself) is caught: slice(0, -3) here would return 2
    // entries, not [].
    const goods = [
      { goodId: "water", satisfaction: 0.5, demanded: 10 },
      { goodId: "food", satisfaction: 0.4, demanded: 10 },
      { goodId: "medicine", satisfaction: 0.3, demanded: 10 },
      { goodId: "ore", satisfaction: 0.2, demanded: 10 },
      { goodId: "gas", satisfaction: 0.1, demanded: 10 },
    ];
    expect(worstDemandedGoods(goods, 0)).toEqual([]);
    expect(worstDemandedGoods(goods, -3)).toEqual([]);
  });
});

describe("foldSupplyState (D cut + survival floor)", () => {
  const full = (goodId: string, demanded: number) => ({ goodId, satisfaction: 1, demanded });

  it("is supplied only at D exactly 0", () => {
    const goods = [full("water", 10), full("luxuries", 2)];
    expect(foldSupplyState(goods, dissatisfaction(goods)).regime).toBe("supplied");
    expect(foldSupplyState([], 0).regime).toBe("supplied");
  });

  it("is rationing for any positive D below the cut", () => {
    const goods = [{ goodId: "luxuries", satisfaction: 0, demanded: 2 }, full("water", 100)];
    const state = foldSupplyState(goods, dissatisfaction(goods));
    expect(state.regime).toBe("rationing");
    expect(state.survivalShortfall).toBe(false);
  });

  it("is shortage at or above the cut", () => {
    expect(foldSupplyState([full("ore", 10)], D_SHORTAGE_CUT).regime).toBe("shortage");
    expect(foldSupplyState([full("ore", 10)], D_SHORTAGE_CUT - 1e-9).regime).toBe("rationing");
  });

  it("selects shortage from the survival floor even when D is far below the cut", () => {
    // Water at half rations, at a small demand share against a large well-served ore demand, folds
    // to ~0.1 — nowhere near the cut — yet the population is genuinely on half rations. This is the
    // case the floor exists for. (Demand split chosen so water's own share stays small: that isolates
    // the floor from the cut, which the deep-shortage case below cannot.)
    const goods = [
      { goodId: "water", satisfaction: SHORTAGE_SATISFACTION - 1e-9, demanded: 10 },
      full("ore", 400),
    ];
    const d = dissatisfaction(goods);
    expect(d).toBeLessThan(D_SHORTAGE_CUT);
    const state = foldSupplyState(goods, d);
    expect(state.regime).toBe("shortage");
    expect(state.survivalShortfall).toBe(true);
  });

  it("treats exactly the shortage satisfaction line as not a survival shortfall (strict <)", () => {
    const goods = [{ goodId: "food", satisfaction: SHORTAGE_SATISFACTION, demanded: 100 }];
    expect(foldSupplyState(goods, dissatisfaction(goods)).survivalShortfall).toBe(false);
  });

  it("ignores a zero-demand survival good", () => {
    const goods = [{ goodId: "water", satisfaction: 0, demanded: 0 }, full("ore", 5)];
    expect(foldSupplyState(goods, dissatisfaction(goods)).survivalShortfall).toBe(false);
  });

  it("does not let a non-survival good trip the floor at any depth", () => {
    const goods = [{ goodId: "luxuries", satisfaction: 0, demanded: 5 }, full("water", 5)];
    expect(foldSupplyState(goods, dissatisfaction(goods)).survivalShortfall).toBe(false);
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
  it("collapses to a hard step at the cap when crowdBrakeEnd <= 1 (span <= 0)", () => {
    // span = crowdBrakeEnd - 1 <= 0 skips the smoothstep entirely: population > popCap ? 0 : 1.
    expect(crowdFactor(999, 1000, 1)).toBe(1); // below cap
    expect(crowdFactor(1000, 1000, 1)).toBe(1); // exactly at cap
    expect(crowdFactor(1001, 1000, 1)).toBe(0); // above cap
    // A brakeEnd below 1 hits the same branch (span is still <= 0).
    expect(crowdFactor(999, 1000, 0.9)).toBe(1);
    expect(crowdFactor(1001, 1000, 0.9)).toBe(0);
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
  it("collapses to a hard step at the cap when brakeEnd <= 1 (span <= 0)", () => {
    // span = brakeEnd - 1 <= 0 skips the linear ramp entirely: population > popCap ? maxPressure : 0.
    expect(crowdingPressure(999, 1000, 1, MAX)).toBe(0); // below cap
    expect(crowdingPressure(1000, 1000, 1, MAX)).toBe(0); // exactly at cap
    expect(crowdingPressure(1001, 1000, 1, MAX)).toBeCloseTo(MAX, 6); // above cap
    // A brakeEnd below 1 hits the same branch (span is still <= 0).
    expect(crowdingPressure(999, 1000, 0.9, MAX)).toBe(0);
    expect(crowdingPressure(1001, 1000, 0.9, MAX)).toBeCloseTo(MAX, 6);
  });
});

describe("accumulateUnrest (floor-relaxation integrator)", () => {
  const params: UnrestParams = { slopeRationing: 1.8, slopeShortage: 2.5, decay: 0.06 };
  const state = (regime: SupplyRegime, survivalShortfall = false): SupplyState => ({ regime, survivalShortfall });
  const SUPPLIED = state("supplied");
  const RATIONING = state("rationing");
  const SHORTAGE = state("shortage");

  it("relaxes at the identical rate whatever the label carries — regime selects nothing here", () => {
    // The only test that catches a leftover `supply.regime` read inside accumulateUnrest: a
    // fixture that changes only the label, holding start/floor/D fixed, must trace identically.
    const start = 0.6;
    const floor = 0.2;
    const d = 0.15;
    const trajectory = (supply: SupplyState) => {
      let u = start;
      const path: number[] = [];
      for (let i = 0; i < 10; i++) {
        u = accumulateUnrest(u, d, floor, supply, params);
        path.push(u);
      }
      return path;
    };
    const supplied = trajectory(SUPPLIED);
    expect(trajectory(RATIONING)).toEqual(supplied);
    expect(trajectory(SHORTAGE)).toEqual(supplied);
  });

  it("stays exactly at the floor from a start at the floor, whatever the label", () => {
    for (const supply of [SUPPLIED, RATIONING, SHORTAGE]) {
      expect(accumulateUnrest(0.3, 0, 0.3, supply, params)).toBeCloseTo(0.3, 12);
    }
  });

  it("settles exactly at the floor from above and below at D = 0, whatever the label", () => {
    let above = 0.9;
    for (let i = 0; i < 2000; i++) above = accumulateUnrest(above, 0, 0.2, SUPPLIED, params);
    expect(above).toBeCloseTo(0.2, 6);
    let aboveOther = 0.9;
    for (let i = 0; i < 2000; i++) aboveOther = accumulateUnrest(aboveOther, 0, 0.2, RATIONING, params);
    expect(aboveOther).toBeCloseTo(0.2, 6);
    // From below (a highly taxed but well-fed colony rising toward its floor).
    let below = 0.05;
    for (let i = 0; i < 2000; i++) below = accumulateUnrest(below, 0, 0.3, SUPPLIED, params);
    expect(below).toBeCloseTo(0.3, 6);
  });

  it("settles at floor + slope x D under sustained dissatisfaction", () => {
    // The reparameterisation's whole point: the slope is settled unrest per unit of D above the
    // floor, so the settled value is readable straight off the constants rather than implied by a
    // gain/decay ratio. Two D's, one either side of the shortage cut. Both sums stay under 1, so
    // the state's own clamp is not in play here — that boundary is pinned separately below.
    for (const [d, floor] of [[0.1, 0.2], [0.3, 0]] as const) {
      let u = 0;
      for (let i = 0; i < 500; i++) u = accumulateUnrest(u, d, floor, RATIONING, params);
      expect(floor + unrestSlope(d, false, params) * d, `D=${d}`).toBeLessThan(1);
      expect(u, `D=${d}`).toBeCloseTo(floor + unrestSlope(d, false, params) * d, 6);
    }
  });

  it("saturates at 1 when floor + slope x D would exceed the state's own range", () => {
    // The slopes exceed 1 by design — D is small (mean ~0.15), so a slope of 1 could never lift
    // famine over the strike threshold. That means `floor + slope × D` can ask for more than unrest
    // can hold, and equilibrium is min(1, …) rather than the raw sum. This is the corner where it
    // bites: the highest standing floor (very-high tax + full crowding) under a total water failure.
    const floor = 0.23;
    const d = 0.37;
    expect(floor + unrestSlope(d, true, params) * d).toBeGreaterThan(1); // the raw sum overflows
    let u = 0;
    for (let i = 0; i < 500; i++) u = accumulateUnrest(u, d, floor, state("shortage", true), params);
    expect(u).toBe(1);
  });

  it("reaches the same equilibrium at any relaxation rate", () => {
    // gain = slope x decay, so the rate sets only how fast equilibrium arrives, never where it is —
    // which is what makes the settled level invariant to the tick's catch-up factor.
    const slow: UnrestParams = { ...params, decay: 0.06 };
    const fast: UnrestParams = { ...params, decay: 0.5 };
    const settle = (p: UnrestParams) => {
      let u = 0;
      for (let i = 0; i < 500; i++) u = accumulateUnrest(u, 0.3, 0.1, RATIONING, p);
      return u;
    };
    expect(settle(fast)).toBeCloseTo(settle(slow), 6);
  });

  it("relaxes stored excess geometrically at the single decay rate, whatever the label", () => {
    // The re-authored drain law: excess above the floor shrinks by (1 - decay) every step, and
    // that ratio must hold identically for every label — a leftover regime branch (or a relaxation
    // that snapped straight to the floor) would break it.
    const floor = 0.2;
    const start = 0.6;
    for (const supply of [SUPPLIED, RATIONING, SHORTAGE]) {
      const s1 = accumulateUnrest(start, 0, floor, supply, params);
      const s2 = accumulateUnrest(s1, 0, floor, supply, params);
      expect((s2 - floor) / (start - floor)).toBeCloseTo((1 - params.decay) ** 2, 10);
    }
  });

  it("accumulates faster under a survival shortfall than at the same D without one", () => {
    // The regime label no longer selects the magnitude — D and the survival bit do. Famine at a D
    // the fold alone would call mild must still respond like famine.
    const d = 0.1;
    const ordinary = accumulateUnrest(0.2, d, 0.2, RATIONING, params);
    const famine = accumulateUnrest(0.2, d, 0.2, state("shortage", true), params);
    expect(famine).toBeGreaterThan(ordinary);
  });

  it("is monotonic in both slope selectors — a worse reading never lowers settled unrest", () => {
    // Equilibrium, not one step: the regime label picks only the approach rate, so comparing single
    // steps across labels compares speeds rather than severities.
    const floor = 0.2;
    const eq = (d: number, survivalShortfall: boolean) => floor + unrestSlope(d, survivalShortfall, params) * d;
    for (const d of [0, 0.05, 0.14, 0.25, 0.28, 0.32, 0.5, 1]) {
      expect(eq(d, true), `D=${d}`).toBeGreaterThanOrEqual(eq(d, false));
    }
    const ds = [0, 0.05, 0.14, 0.25, 0.28, 0.32, 0.5, 1];
    for (let i = 1; i < ds.length; i++) {
      expect(eq(ds[i], false), `D=${ds[i]}`).toBeGreaterThan(eq(ds[i - 1], false));
    }
  });

  it("keeps one full-shortage cycle from floor 0.23 below the 0.65 strike threshold", () => {
    // catchUpFactor = 2 is applied by the processor; the engine receives a pre-scaled relaxation rate.
    const scaled: UnrestParams = { ...params, decay: 0.06 * 2 };
    const next = accumulateUnrest(0.23, 1, 0.23, SHORTAGE, scaled);
    expect(next).toBeGreaterThan(0.23); // it rose
    expect(next).toBeLessThan(0.65); // but is recoverable, not an instant strike
  });

  it("clamps output to [0,1]", () => {
    const big: UnrestParams = { ...params, slopeRationing: 50, slopeShortage: 50 };
    expect(accumulateUnrest(1, 1, 0.9, SHORTAGE, big)).toBe(1);
    expect(accumulateUnrest(0, 0, 0, SUPPLIED, params)).toBe(0);
  });

  it("clamps k so a catch-up-scaled decay can never overshoot below the floor", () => {
    // A large catch-up can scale the decay past 1; without clamping k the relaxation
    // term would flip sign and push unrest below its standing floor.
    const overScaled: UnrestParams = { ...params, decay: 1.5 };
    const next = accumulateUnrest(0.5, 0, 0.2, SUPPLIED, overScaled);
    expect(next).toBe(0.2); // k clamps to 1 -> lands exactly on the floor, no overshoot
    expect(next).toBeGreaterThanOrEqual(0.2);
    // A realistic catch-up = 2 relaxes toward the floor from above without crossing it.
    const scaled: UnrestParams = { ...params, decay: 0.06 * 2 };
    const step = accumulateUnrest(0.5, 0, 0.2, SUPPLIED, scaled);
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
