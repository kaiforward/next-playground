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
  grievanceShortfall,
  supplyUnrestTerm,
  type UnrestParams,
  type PopulationParams,
  type SupplyState,
} from "../population";
import {
  SHORTAGE_SATISFACTION,
  SUPPLIED_PROVISION,
  RATIONING_PROVISION,
  DEPRIVED_PROVISION,
  CRITICAL_SATISFACTION,
  BAND_MIN_DEMAND_SHARE,
} from "@/lib/constants/economy";
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

  it("folds a demanded: NaN reading to zero weight rather than poisoning the mean — a corrupted reading cannot claim weight, same as demanded: 0", () => {
    const base = [
      { goodId: "water", satisfaction: 0.4, demanded: 10 },
      { goodId: "food", satisfaction: 0.9, demanded: 5 },
    ];
    const withNaNDemand = [...base, { goodId: "medicine", satisfaction: 0, demanded: NaN }];
    expect(Number.isNaN(provision(withNaNDemand))).toBe(false);
    expect(provision(withNaNDemand)).toBeCloseTo(provision(base), 10);
    expect(Number.isNaN(dissatisfaction(withNaNDemand))).toBe(false);
    expect(dissatisfaction(withNaNDemand)).toBeCloseTo(dissatisfaction(base), 10);
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

describe("foldSupplyState (four bands binned from Provision, survival punch-through)", () => {
  const full = (goodId: string, demanded: number) => ({ goodId, satisfaction: 1, demanded });
  const bandFor = (p: number) =>
    p >= SUPPLIED_PROVISION ? "supplied"
      : p >= RATIONING_PROVISION ? "strained"
        : p >= DEPRIVED_PROVISION ? "rationing"
          : "deprived";

  it("bins from provision() itself, in each of the four Provision bands — the one implementation a re-implemented mean would drift from", () => {
    // Two goods of sharply different necessity, so an unweighted mean of the raw satisfactions would
    // land in a different band than the necessity-and-demand-weighted provision() does. If
    // foldSupplyState ever re-implemented its own mean instead of calling provision(), a fixture like
    // this is what would expose the drift — computing the expected band from provision() itself
    // (rather than a hardcoded number) means the two can never silently agree by coincidence.
    // Neither good is a survival good, so the survival floor never interferes — this fixture set
    // isolates the Provision bin from the punch-through entirely.
    const suppliedGoods = [full("ore", 10), { goodId: "medicine", satisfaction: 0.9, demanded: 5 }];
    const strainedGoods = [
      { goodId: "ore", satisfaction: 0.82, demanded: 10 },
      { goodId: "medicine", satisfaction: 0.7, demanded: 5 },
    ];
    // The two low fixtures are the discriminating ones: ore's weight is 10 × 0.1 = 1 against
    // medicine's 5 × 0.8 = 4, so the weighted fold lands a whole band BELOW the plain mean of the
    // two satisfactions (0.63 vs 0.75, and 0.46 vs 0.625). An unweighted re-implementation reads
    // Strained and Rationing here instead of Rationing and Deprived.
    const rationingGoods = [
      { goodId: "ore", satisfaction: 0.95, demanded: 10 },
      { goodId: "medicine", satisfaction: 0.55, demanded: 5 },
    ];
    const deprivedGoods = [
      { goodId: "ore", satisfaction: 0.9, demanded: 10 },
      { goodId: "medicine", satisfaction: 0.35, demanded: 5 },
    ];
    const fixtures = [suppliedGoods, strainedGoods, rationingGoods, deprivedGoods];
    for (const goods of fixtures) {
      expect(foldSupplyState(goods).regime).toBe(bandFor(provision(goods)));
    }
    // Guard against every fixture accidentally landing in the same band, which would let the loop
    // above pass without actually exercising all four.
    expect(new Set(fixtures.map((g) => foldSupplyState(g).regime)).size).toBe(4);
    // …and name them, so a fixture that drifted into the wrong band fails here rather than quietly
    // re-testing a band already covered (bandFor above would still agree with the fold).
    expect(fixtures.map((g) => foldSupplyState(g).regime))
      .toEqual(["supplied", "strained", "rationing", "deprived"]);
  });

  it("all three bin edges are inclusive on the side their docstrings state", () => {
    // A single demanded good's provision() equals its own satisfaction exactly, whatever its
    // necessity — share is 1 either way — so these fixtures land precisely on the edges. `ore` is
    // used at the Deprived edge rather than `food`: the DEPRIVED_PROVISION edge (0.5) is exactly
    // SHORTAGE_SATISFACTION, so a survival good sitting a hair under it would trip the famine
    // punch-through and this would be testing that instead of the bin.
    const atSupplied = [{ goodId: "food", satisfaction: SUPPLIED_PROVISION, demanded: 10 }];
    expect(provision(atSupplied)).toBeCloseTo(SUPPLIED_PROVISION, 10);
    expect(foldSupplyState(atSupplied).regime).toBe("supplied"); // at-or-above: still Supplied

    const justBelowSupplied = [{ goodId: "food", satisfaction: SUPPLIED_PROVISION - 1e-9, demanded: 10 }];
    expect(foldSupplyState(justBelowSupplied).regime).toBe("strained");

    const atRationing = [{ goodId: "food", satisfaction: RATIONING_PROVISION, demanded: 10 }];
    expect(foldSupplyState(atRationing).regime).toBe("strained"); // at-or-above: still Strained

    const justBelowRationing = [{ goodId: "food", satisfaction: RATIONING_PROVISION - 1e-9, demanded: 10 }];
    expect(foldSupplyState(justBelowRationing).regime).toBe("rationing");

    const atDeprived = [{ goodId: "ore", satisfaction: DEPRIVED_PROVISION, demanded: 10 }];
    expect(provision(atDeprived)).toBeCloseTo(DEPRIVED_PROVISION, 10);
    expect(foldSupplyState(atDeprived).regime).toBe("rationing"); // at-or-above: still Rationing
    expect(foldSupplyState(atDeprived).survivalShortfall).toBe(false); // the bin, not the punch-through

    const justBelowDeprived = [{ goodId: "ore", satisfaction: DEPRIVED_PROVISION - 1e-9, demanded: 10 }];
    expect(foldSupplyState(justBelowDeprived).regime).toBe("deprived");
    expect(foldSupplyState(justBelowDeprived).survivalShortfall).toBe(false);
  });

  it("famine can read at ANY Provision — it owns no span of the axis, so it is never a fifth bin", () => {
    // The property the whole design rests on: the survival punch-through is orthogonal to the axis.
    // A world starving on water while everything else pours in reads Famine at a Supplied-grade
    // Provision; a world starving on water with nothing else either reads Famine at a Deprived-grade
    // one. An implementation that binned famine as "the band below Deprived" would fail the first.
    const famineHigh = [
      { goodId: "water", satisfaction: SHORTAGE_SATISFACTION - 1e-9, demanded: 1 },
      full("medicine", 10000),
    ];
    expect(provision(famineHigh)).toBeGreaterThanOrEqual(SUPPLIED_PROVISION);
    expect(foldSupplyState(famineHigh).regime).toBe("famine");

    const famineLow = [{ goodId: "water", satisfaction: 0.01, demanded: 10 }];
    expect(provision(famineLow)).toBeLessThan(DEPRIVED_PROVISION);
    expect(foldSupplyState(famineLow).regime).toBe("famine");

    // …and the axis's own bottom band is NOT famine: the same near-zero Provision, reached without
    // touching a survival good, still reads Deprived. Without this pair, a fold that promoted every
    // Deprived world to Famine would pass the two assertions above.
    const deprivedNotFamine = [{ goodId: "medicine", satisfaction: 0.01, demanded: 10 }];
    expect(provision(deprivedNotFamine)).toBeLessThan(DEPRIVED_PROVISION);
    expect(foldSupplyState(deprivedNotFamine).regime).toBe("deprived");
    expect(foldSupplyState(deprivedNotFamine).survivalShortfall).toBe(false);
  });

  it("a survival good below the survival line bands Famine whatever Provision says; a non-survival good at the identical satisfaction does not", () => {
    const survivalShort = [
      { goodId: "water", satisfaction: SHORTAGE_SATISFACTION - 1e-9, demanded: 1 },
      full("ore", 1000),
    ];
    expect(provision(survivalShort)).toBeGreaterThan(SUPPLIED_PROVISION); // Provision alone reads healthy
    expect(foldSupplyState(survivalShort).regime).toBe("famine");
    expect(foldSupplyState(survivalShort).survivalShortfall).toBe(true);

    const nonSurvivalSameSat = [
      { goodId: "luxuries", satisfaction: SHORTAGE_SATISFACTION - 1e-9, demanded: 1 },
      full("ore", 1000),
    ];
    expect(foldSupplyState(nonSurvivalSameSat).regime).not.toBe("famine");
    expect(foldSupplyState(nonSurvivalSameSat).survivalShortfall).toBe(false);
  });

  it("treats exactly the shortage satisfaction line as not a survival shortfall (strict <)", () => {
    const goods = [{ goodId: "food", satisfaction: SHORTAGE_SATISFACTION, demanded: 100 }];
    expect(foldSupplyState(goods).survivalShortfall).toBe(false);
  });

  it("ignores a zero-demand survival good", () => {
    const goods = [{ goodId: "water", satisfaction: 0, demanded: 0 }, full("ore", 5)];
    expect(foldSupplyState(goods).survivalShortfall).toBe(false);
  });

  it("does not let a non-survival good trip the floor at any depth", () => {
    const goods = [{ goodId: "luxuries", satisfaction: 0, demanded: 5 }, full("water", 5)];
    expect(foldSupplyState(goods).survivalShortfall).toBe(false);
  });

  it("an epsilon-demand good below the criticality line bands by Provision alone and contributes no override weight", () => {
    // 1 of 1000 total demand = 0.1%, well under BAND_MIN_DEMAND_SHARE (1%) — a trace entry, not a
    // real need, exactly the skilled-basket-epsilon case the floor exists to exclude.
    const goods = [
      { goodId: "medicine", satisfaction: CRITICAL_SATISFACTION - 0.01, demanded: 1 },
      full("ore", 999),
    ];
    const demandShare = 1 / 1000;
    expect(demandShare).toBeLessThan(BAND_MIN_DEMAND_SHARE);
    const state = foldSupplyState(goods);
    expect(state.regime).toBe(bandFor(provision(goods)));
    expect(state.criticalWeight).toBe(0);
  });

  it("an eligible critical good on a high-Provision world leaves the band exactly where Provision bins it; criticalWeight is proportional to necessity × demand share and zero above the line", () => {
    const goods = [
      full("water", 1000), // dominant, fully served — keeps Provision high
      { goodId: "components", satisfaction: CRITICAL_SATISFACTION - 0.01, demanded: 100 }, // 100/1100 ≈ 9.1% share, well above the floor
    ];
    const p = provision(goods);
    expect(p).toBeGreaterThanOrEqual(SUPPLIED_PROVISION);
    const state = foldSupplyState(goods);
    expect(state.regime).toBe("supplied"); // the override never changes the label
    const expectedWeight = GOOD_NECESSITY.components * (100 / 1100);
    expect(state.criticalWeight).toBeCloseTo(expectedWeight, 10);

    // Every good above the criticality line contributes zero, however large its demand share.
    const allAboveCriticality = [full("water", 1000), full("components", 100)];
    expect(foldSupplyState(allAboveCriticality).criticalWeight).toBe(0);
  });

  it("bands an empty basket Supplied with zero critical weight and no division by zero", () => {
    const state = foldSupplyState([]);
    expect(state.regime).toBe("supplied");
    expect(state.criticalWeight).toBe(0);
    expect(Number.isFinite(state.criticalWeight)).toBe(true);
  });

  it("emptyBasket is true exactly when the basket's summed weight is <= 0", () => {
    // No rows at all: the degenerate case, Σ weight = 0.
    expect(foldSupplyState([]).emptyBasket).toBe(true);
    // Rows present but every one contributes zero weight — one at demanded 0, one unauthored
    // (necessity 0) — so the basket carries no real weight despite not being literally empty.
    const allZeroWeight = [
      { goodId: "water", satisfaction: 0.5, demanded: 0 },
      { goodId: "not_a_good", satisfaction: 0.5, demanded: 100 },
    ];
    expect(foldSupplyState(allZeroWeight).emptyBasket).toBe(true);
    // One weighted good is enough to clear it.
    const oneWeighted = [...allZeroWeight, { goodId: "food", satisfaction: 0.5, demanded: 10 }];
    expect(foldSupplyState(oneWeighted).emptyBasket).toBe(false);
  });
});

describe("grievanceShortfall (expectation-relative shortfall)", () => {
  it("reads 0 whenever expectation is at or below provision — matching or beating memory is peace", () => {
    expect(grievanceShortfall(0.5, 0.5)).toBe(0);
    expect(grievanceShortfall(0.3, 0.5)).toBe(0);
    expect(grievanceShortfall(0, 1)).toBe(0);
  });

  it("never exceeds 1, whatever expectation and provision — including out-of-range inputs", () => {
    expect(grievanceShortfall(1, 0)).toBe(1);
    expect(grievanceShortfall(5, -5)).toBe(1);
  });

  it("is exactly expectation minus provision once inside [0,1]", () => {
    expect(grievanceShortfall(0.8, 0.3)).toBeCloseTo(0.5, 10);
  });
});

describe("supplyUnrestTerm (max of a memory-relative grievance reading and an absolute crisis reading)", () => {
  const params: UnrestParams = { slopeBase: 1.6, slopeShortage: 2.4, decay: 0.06 };
  const benign: SupplyState = { regime: "rationing", survivalShortfall: false, criticalWeight: 0, emptyBasket: false };
  const survival = (criticalWeight = 0): SupplyState =>
    ({ regime: "famine", survivalShortfall: true, criticalWeight, emptyBasket: false });
  const critical = (criticalWeight: number): SupplyState =>
    ({ regime: "rationing", survivalShortfall: false, criticalWeight, emptyBasket: false });

  it("is 0 for a benign supply state at zero grievance and zero D — vacuity", () => {
    // An empty-implementation term (always 0) would also pass this alone — the famine and crisis
    // entries below are what an always-0 stub fails.
    expect(supplyUnrestTerm(0, 0, benign, params)).toBe(0);
  });

  it("reads famine dominance exactly: at E = 1 (grievance = D) a survival shortfall reads exactly slopeShortage × D", () => {
    // Famine dominance rests on G <= D whenever E <= 1 (readExpectation's guarantee); the tightest
    // case is E = 1 exactly, where G = D. A sum-instead-of-max implementation reads
    // slopeBase × D + slopeShortage × D here instead — strictly more than the exact famine reading.
    const d = 0.4;
    const grievance = d;
    expect(supplyUnrestTerm(grievance, d, survival(), params)).toBeCloseTo(params.slopeShortage * d, 10);
  });

  it("restores the crisis floor: an accustomed world (G = 0) with critical weight w reads min(slopeShortage, slopeBase + w × span) × D", () => {
    const d = 0.5;
    const w = 0.4;
    const span = params.slopeShortage - params.slopeBase;
    const expected = Math.min(params.slopeShortage, params.slopeBase + w * span) * d;
    const term = supplyUnrestTerm(0, d, critical(w), params);
    expect(term).toBeCloseTo(expected, 10);
    // A coefficient-only implementation (no base slope, i.e. w × span × d alone) reads far smaller —
    // guard the margin explicitly so that revert cannot slip past a close-enough tolerance.
    expect(term).toBeGreaterThan(w * span * d * 2);
  });

  it("caps the critical-good override at slopeShortage, whatever weight it carries", () => {
    const d = 0.5;
    expect(supplyUnrestTerm(0, d, critical(5), params)).toBeCloseTo(params.slopeShortage * d, 10);
  });

  it("reads exactly 0 crisis contribution absent both a survival shortfall and any critical weight — the ordinary case answers to memory alone", () => {
    // Grievance is fixed at 0, so any nonzero result here could only have come from the crisis
    // branch. This is the composition the max() depends on: a crisis term that fired
    // slopeBase × D on every benign supply state would make the whole term absolute again and erase
    // the point of reading memory at all.
    expect(supplyUnrestTerm(0, 0.6, benign, params)).toBe(0);
  });

  it("is flat and linear in grievance across [0,1] — no reintroduced escalation ramp", () => {
    // d = 0 zeroes the crisis term regardless of label, isolating the grievance term.
    const samples = [0, 0.2, 0.5, 0.8, 1];
    for (const g of samples) {
      expect(supplyUnrestTerm(g, 0, benign, params)).toBeCloseTo(params.slopeBase * g, 10);
    }
    // Doubling grievance (within range) exactly doubles the term — the flat-slope signature a
    // reintroduced ramp would break.
    expect(supplyUnrestTerm(0.4, 0, benign, params)).toBeCloseTo(2 * supplyUnrestTerm(0.2, 0, benign, params), 10);
  });

  it("never exceeds 1 in grievance's own contribution beyond G = 1 — the clamp carries through", () => {
    // Grievance above 1 (an out-of-range caller value) must not blow the term past slopeBase × 1.
    expect(supplyUnrestTerm(5, 0, benign, params)).toBeCloseTo(params.slopeBase, 10);
  });

  it("takes the larger reading, not the sum, when both grievance and crisis apply", () => {
    const d = 0.5;
    const w = 0.9;
    const highGrievance = 1;
    const term = supplyUnrestTerm(highGrievance, d, critical(w), params);
    const grievanceTerm = params.slopeBase * highGrievance;
    const crisisTerm = Math.min(params.slopeShortage, params.slopeBase + w * (params.slopeShortage - params.slopeBase)) * d;
    expect(term).toBeCloseTo(Math.max(grievanceTerm, crisisTerm), 10);
    expect(term).toBeLessThan(grievanceTerm + crisisTerm);
  });

  it("ignores `regime` entirely — only survivalShortfall and criticalWeight feed the term", () => {
    const g = 0.3;
    const d = 0.2;
    for (const regime of ["supplied", "strained", "rationing", "deprived", "famine"] as const) {
      const supply: SupplyState = { regime, survivalShortfall: false, criticalWeight: 0, emptyBasket: false };
      expect(supplyUnrestTerm(g, d, supply, params)).toBeCloseTo(params.slopeBase * g, 10);
    }
  });

  it("clamps a negative criticalWeight to 0 rather than propagating", () => {
    expect(supplyUnrestTerm(0, 0.5, critical(-3), params)).toBe(0);
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

describe("accumulateUnrest (floor-relaxation integrator over a caller-supplied term)", () => {
  const params: UnrestParams = { slopeBase: 1.8, slopeShortage: 2.5, decay: 0.06 };

  it("stays exactly at the floor from a start at the floor, at term 0", () => {
    expect(accumulateUnrest(0.3, 0, 0.3, params)).toBeCloseTo(0.3, 12);
  });

  it("settles exactly at the floor from above and below at term 0", () => {
    let above = 0.9;
    for (let i = 0; i < 2000; i++) above = accumulateUnrest(above, 0, 0.2, params);
    expect(above).toBeCloseTo(0.2, 6);
    // From below (a highly taxed but well-fed colony rising toward its floor).
    let below = 0.05;
    for (let i = 0; i < 2000; i++) below = accumulateUnrest(below, 0, 0.3, params);
    expect(below).toBeCloseTo(0.3, 6);
  });

  it("settles at floor + term under a sustained term", () => {
    // `term` is already the full settled-unrest contribution above the floor — the caller
    // (supplyUnrestTerm) has already folded slope and D/grievance together — so the fixed point is
    // readable straight off the two inputs, not implied by a gain/decay ratio. Two (term, floor)
    // pairs whose sum stays under 1, so the state's own clamp is not in play here — that boundary is
    // pinned separately below.
    for (const [term, floor] of [[0.18, 0.2], [0.72, 0]] as const) {
      let u = 0;
      for (let i = 0; i < 500; i++) u = accumulateUnrest(u, term, floor, params);
      expect(floor + term, `term=${term}`).toBeLessThan(1);
      expect(u, `term=${term}`).toBeCloseTo(floor + term, 6);
    }
  });

  it("saturates at 1 when floor + term would exceed the state's own range", () => {
    // `term` can itself exceed 1 (slopeShortage alone does), so `floor + term` can ask for more than
    // unrest can hold, and equilibrium is min(1, …) rather than the raw sum.
    const floor = 0.23;
    const term = params.slopeShortage * 0.37; // the crisis reading for a near-total water failure
    expect(floor + term).toBeGreaterThan(1); // the raw sum overflows
    let u = 0;
    for (let i = 0; i < 500; i++) u = accumulateUnrest(u, term, floor, params);
    expect(u).toBe(1);
  });

  it("reaches the same equilibrium at any relaxation rate", () => {
    // gain = term x decay, so the rate sets only how fast equilibrium arrives, never where it is —
    // which is what makes the settled level invariant to the tick's catch-up factor.
    const slow: UnrestParams = { ...params, decay: 0.06 };
    const fast: UnrestParams = { ...params, decay: 0.5 };
    const settle = (p: UnrestParams) => {
      let u = 0;
      for (let i = 0; i < 500; i++) u = accumulateUnrest(u, 0.3, 0.1, p);
      return u;
    };
    expect(settle(fast)).toBeCloseTo(settle(slow), 6);
  });

  it("relaxes stored excess geometrically at the single decay rate", () => {
    // Excess above the floor shrinks by (1 - decay) every step at term 0.
    const floor = 0.2;
    const start = 0.6;
    const s1 = accumulateUnrest(start, 0, floor, params);
    const s2 = accumulateUnrest(s1, 0, floor, params);
    expect((s2 - floor) / (start - floor)).toBeCloseTo((1 - params.decay) ** 2, 10);
  });

  it("integrates a larger term into more settled unrest — composed with supplyUnrestTerm, famine outweighs an ordinary shortfall at the same D", () => {
    // accumulateUnrest itself no longer picks a severity — supplyUnrestTerm does, upstream — so this
    // is a composed check that the two functions still agree once wired together: a survival
    // shortfall at a D the ordinary (benign) reading would call mild must still integrate to more
    // settled unrest than the benign reading at the identical D and grievance.
    const d = 0.1;
    const grievance = 0;
    const benign: SupplyState = { regime: "rationing", survivalShortfall: false, criticalWeight: 0, emptyBasket: false };
    const famine: SupplyState = { regime: "famine", survivalShortfall: true, criticalWeight: 0, emptyBasket: false };
    const ordinary = accumulateUnrest(0.2, supplyUnrestTerm(grievance, d, benign, params), 0.2, params);
    const famineUnrest = accumulateUnrest(0.2, supplyUnrestTerm(grievance, d, famine, params), 0.2, params);
    expect(famineUnrest).toBeGreaterThan(ordinary);
  });

  it("keeps one full-shortage cycle from floor 0.23 below the 0.65 strike threshold", () => {
    // catchUpFactor = 2 is applied by the processor; the engine receives a pre-scaled relaxation rate.
    const scaled: UnrestParams = { ...params, decay: 0.06 * 2 };
    const famine: SupplyState = { regime: "famine", survivalShortfall: true, criticalWeight: 0, emptyBasket: false };
    const term = supplyUnrestTerm(1, 1, famine, scaled);
    const next = accumulateUnrest(0.23, term, 0.23, scaled);
    expect(next).toBeGreaterThan(0.23); // it rose
    expect(next).toBeLessThan(0.65); // but is recoverable, not an instant strike
  });

  it("clamps output to [0,1]", () => {
    expect(accumulateUnrest(1, 50, 0.9, params)).toBe(1);
    expect(accumulateUnrest(0, 0, 0, params)).toBe(0);
  });

  it("clamps k so a catch-up-scaled decay can never overshoot below the floor", () => {
    // A large catch-up can scale the decay past 1; without clamping k the relaxation
    // term would flip sign and push unrest below its standing floor.
    const overScaled: UnrestParams = { ...params, decay: 1.5 };
    const next = accumulateUnrest(0.5, 0, 0.2, overScaled);
    expect(next).toBe(0.2); // k clamps to 1 -> lands exactly on the floor, no overshoot
    expect(next).toBeGreaterThanOrEqual(0.2);
    // A realistic catch-up = 2 relaxes toward the floor from above without crossing it.
    const scaled: UnrestParams = { ...params, decay: 0.06 * 2 };
    const step = accumulateUnrest(0.5, 0, 0.2, scaled);
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
    const delta = populationDelta(990, 1000, 0, 0, p, 1);
    expect(delta).toBeCloseTo(p.growthRate * 990, 6); // full rate, ~19.8
    expect(delta).toBeGreaterThan(1); // old logistic would give ~0.198
  });

  it("still grows at full rate at exactly the cap (r = 1)", () => {
    expect(populationDelta(1000, 1000, 0, 0, p, 1)).toBeCloseTo(p.growthRate * 1000, 6);
  });

  it("has zero growth at or beyond the brake end (r >= 1.15)", () => {
    expect(populationDelta(1150, 1000, 0, 0, p, 1)).toBeCloseTo(0, 6);
    expect(populationDelta(1200, 1000, 0, 0, p, 1)).toBeCloseTo(0, 6);
  });

  it("declines with unrest exactly as before (growth suppressed by full dissatisfaction)", () => {
    // D = 1 zeroes growth, isolating the unchanged decline term: declineRate * pop * unrest.
    expect(populationDelta(500, 1000, 1, 0.5, p, 1)).toBeCloseTo(-(p.declineRate * 500 * 0.5), 6);
  });

  it("has no growth term when popCap is 0", () => {
    expect(populationDelta(100, 0, 0, 0, p, 1)).toBe(0);
  });

  it("stays at 0 when population is already 0", () => {
    expect(populationDelta(0, 1000, 0.5, 0.5, p, 1)).toBe(0);
  });

  it("quality multiplies the growth term only — decline and overshoot-death are bit-identical", () => {
    // Same growth-bearing state (r < 1, D = 0) at three quality values: growth scales linearly
    // with quality, nothing else in the formula moves.
    const full = populationDelta(500, 1000, 0, 0, p, 1);
    const half = populationDelta(500, 1000, 0, 0, p, 0.5);
    const zero = populationDelta(500, 1000, 0, 0, p, 0);
    expect(full).toBeCloseTo(p.growthRate * 500, 6);
    expect(half).toBeCloseTo(full / 2, 6);
    expect(zero).toBeCloseTo(0, 6);

    // Decline (unrest > 0, D = 1 so growth is zeroed by satisfaction anyway) is bit-identical
    // across quality — the decline term never reads quality at all.
    const declineAtQ1 = populationDelta(500, 1000, 1, 0.5, p, 1);
    const declineAtQ0 = populationDelta(500, 1000, 1, 0.5, p, 0);
    expect(declineAtQ1).toBe(declineAtQ0);

    // Overshoot-death (past the cap, above the unrest gate) is bit-identical across quality too.
    const deathParams: PopulationParams = { ...p, overshootDeathRate: 0.1 };
    const deathAtQ1 = populationDelta(1200, 1000, 0, 0.7, deathParams, 1);
    const deathAtQ0 = populationDelta(1200, 1000, 0, 0.7, deathParams, 0);
    expect(deathAtQ1).toBe(deathAtQ0);
  });

  it("sign condition: with growthRate == declineRate, net is negative once quality * crowdFactor * (1-d) < unrest", () => {
    // r = 0.5 (well under the cap) -> crowdFactor = 1. d = 0 -> satisfactionFactor = 1. quality =
    // 0.6. growth = growthRate * pop * 1 * 1 * 0.6 = 0.02 * 500 * 0.6 = 6. decline needs unrest such
    // that declineRate * pop * unrest > 6: 0.02 * 500 * unrest > 6 <=> unrest > 0.6. Pin the exact
    // boundary and one point on each side.
    const equalRates: PopulationParams = { ...p, growthRate: 0.02, declineRate: 0.02 };
    const atBoundary = populationDelta(500, 1000, 0, 0.6, equalRates, 0.6);
    expect(atBoundary).toBeCloseTo(0, 6); // growth 6, decline 0.02*500*0.6 = 6 -> net 0

    const belowUnrest = populationDelta(500, 1000, 0, 0.5, equalRates, 0.6);
    expect(belowUnrest).toBeCloseTo(6 - 0.02 * 500 * 0.5, 6); // 6 - 5 = 1, still positive
    expect(belowUnrest).toBeGreaterThan(0);

    const aboveUnrest = populationDelta(500, 1000, 0, 0.7, equalRates, 0.6);
    expect(aboveUnrest).toBeCloseTo(6 - 0.02 * 500 * 0.7, 6); // 6 - 7 = -1, genuinely negative
    expect(aboveUnrest).toBeLessThan(0);
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
    expect(populationDelta(1000, 1000, 0, 1, deathOnly, 1)).toBeCloseTo(0, 6);
    expect(populationDelta(800, 1000, 0, 1, deathOnly, 1)).toBeCloseTo(0, 6);
  });

  it("does not fire at or below the unrest gate (0.65)", () => {
    expect(populationDelta(1200, 1000, 0, 0.65, deathOnly, 1)).toBeCloseTo(0, 6);
    expect(populationDelta(1200, 1000, 0, 0.5, deathOnly, 1)).toBeCloseTo(0, 6);
  });

  it("fires above the unrest gate, scaled by overshoot and unrest", () => {
    // overshoot = 200, unrest 0.7 -> death = 0.1 * 200 * 0.7 = 14.
    const delta = populationDelta(1200, 1000, 0, 0.7, deathOnly, 1);
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
    expect(populationDelta(1200, 1000, 0, 1, violent, 1)).toBeCloseTo(-(18 + 20), 6);
  });
});

describe("criticalGoodWeight (via foldSupplyState) — the two eligibility edges", () => {
  it("counts a good exactly ON the demand-share floor and excludes one exactly AT the criticality line", () => {
    // Shares over demanded goods: food 0.49, gas 0.50, ore 0.01.
    //  · ore sits exactly ON the 1% share floor and below the criticality line ⇒ it counts.
    //  · gas sits exactly AT the criticality line (0.25) ⇒ it does not; the line is "below", not "at".
    // The weight is therefore ore alone: necessity 0.1 × share 0.01.
    const goods = [
      { goodId: "food", satisfaction: 1, demanded: 49 },
      { goodId: "gas", satisfaction: CRITICAL_SATISFACTION, demanded: 50 },
      { goodId: "ore", satisfaction: 0.1, demanded: 1 },
    ];
    const state = foldSupplyState(goods);
    expect(state.survivalShortfall).toBe(false); // the punch-through is not what is being measured
    expect(state.criticalWeight).toBeCloseTo(GOOD_NECESSITY.ore! * 0.01, 9);
  });
});

describe("crowdFactor — the degenerate cap", () => {
  it("reads an empty world with no housing as fully crowded, not as NaN", () => {
    // popCap 0 with population 0 is 0/0 — the guard is what keeps a NaN out of the growth term.
    expect(crowdFactor(0, 0, 1.5)).toBe(0);
    expect(crowdFactor(10, 0, 1.5)).toBe(0);
  });
});
