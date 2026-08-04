import { describe, it, expect } from "vitest";
import {
  useRatesByGood,
  drawRatesByGood,
  type HonestDemandInput,
  type DrawRateInput,
} from "@/lib/engine/honest-demand";
import { capacityGoodRates, inputDemandFromProduction } from "@/lib/engine/industry";
import { unitResourceVector } from "@/lib/engine/resources";
import { GOOD_NAMES } from "@/lib/constants/goods";
import { VOCATIONAL_SCHOOL_TYPE } from "@/lib/constants/industry";

/**
 * A forge world: an ore extractor feeding a metals factory, with the vocational school
 * that licenses the tier-1 technicians and population well above the head count, so every
 * staffing gate reads 1 and the only scalars left in play are the ones under test.
 * `ore` is the good to assert on — it carries civilian want AND industrial draw.
 */
const BUILDINGS = { ore: 3, metals: 4, [VOCATIONAL_SCHOOL_TYPE]: 1 };
const POPULATION = 400;

function makeInput(productionSuppress: number): HonestDemandInput {
  return {
    buildings: BUILDINGS,
    population: POPULATION,
    yields: unitResourceVector(),
    productionSuppress,
  };
}

function requireUse(rates: ReturnType<typeof useRatesByGood>, goodId: string) {
  const rate = rates.get(goodId);
  if (rate === undefined) throw new Error(`Expected a use rate for ${goodId}`);
  return rate;
}

function requireDraw(rates: ReadonlyMap<string, number>, goodId: string): number {
  const rate = rates.get(goodId);
  if (rate === undefined) throw new Error(`Expected a draw rate for ${goodId}`);
  return rate;
}

describe("useRatesByGood", () => {
  it("scales the industrial half by productionSuppress and leaves civilian want at full rate", () => {
    const full = useRatesByGood(makeInput(1));
    const struck = useRatesByGood(makeInput(0.4));

    // The fixture must actually have industrial draw, or the assertion below is vacuous.
    expect(requireUse(full, "ore").industrial).toBeGreaterThan(0);

    for (const goodId of GOOD_NAMES) {
      const at1 = requireUse(full, goodId);
      const at04 = requireUse(struck, goodId);
      expect(at04.civilian).toBeCloseTo(at1.civilian, 9);
      expect(at04.industrial).toBeCloseTo(at1.industrial * 0.4, 9);
      expect(at04.total).toBeCloseTo(at04.civilian + at04.industrial, 9);
    }
  });

  it("equals today's inputDemandFromProduction on the industrial half at productionSuppress = 1", () => {
    // The no-op baseline: the use figure at full production must reproduce, good for good, the
    // industrial term `toGoodMarketStates` computes today from `capacityGoodRates`.
    const rates = capacityGoodRates(BUILDINGS, POPULATION, unitResourceVector());
    const productionByGood = new Map(rates.map((r) => [r.goodId, r.production]));
    const consumptionByGood = new Map(rates.map((r) => [r.goodId, r.consumption]));

    const use = useRatesByGood(makeInput(1));
    for (const goodId of GOOD_NAMES) {
      const rate = requireUse(use, goodId);
      expect(rate.industrial).toBeCloseTo(inputDemandFromProduction(goodId, productionByGood), 9);
      expect(rate.civilian).toBeCloseTo(consumptionByGood.get(goodId) ?? 0, 9);
    }
  });

  it("reads a non-finite suppress scalar as no suppression", () => {
    const guarded = useRatesByGood(makeInput(Number.NaN));
    const full = useRatesByGood(makeInput(1));
    for (const goodId of GOOD_NAMES) {
      expect(requireUse(guarded, goodId).total).toBeCloseTo(requireUse(full, goodId).total, 9);
    }
  });
});

describe("drawRatesByGood", () => {
  const ungated: DrawRateInput = {
    ...makeInput(1),
    brakeCeilingOf: () => 1,
    productionMultOf: () => 1,
  };

  it("equals the use total when no consumer is braked and no event is running", () => {
    const use = useRatesByGood(ungated);
    const draw = drawRatesByGood(ungated);
    for (const goodId of GOOD_NAMES) {
      expect(requireDraw(draw, goodId)).toBeCloseTo(requireUse(use, goodId).total, 9);
    }
  });

  it("collapses to civilian want when every consumer's brake is shut, leaving the use figure untouched", () => {
    // The test that fails the moment the two figures are collapsed into one. Both calls take the
    // SAME input object, so a use figure that reaches for the brake accessors is caught here.
    const braked: DrawRateInput = {
      ...makeInput(1),
      brakeCeilingOf: () => 0,
      productionMultOf: () => 1,
    };
    const baseline = useRatesByGood(makeInput(1));
    const use = useRatesByGood(braked);
    const draw = drawRatesByGood(braked);

    expect(requireUse(baseline, "ore").industrial).toBeGreaterThan(0);

    for (const goodId of GOOD_NAMES) {
      expect(requireDraw(draw, goodId)).toBeCloseTo(requireUse(baseline, goodId).civilian, 9);
      expect(requireUse(use, goodId).industrial).toBeCloseTo(requireUse(baseline, goodId).industrial, 9);
      expect(requireUse(use, goodId).total).toBeCloseTo(requireUse(baseline, goodId).total, 9);
    }
  });

  it("gates each consumer's term by that consumer's own brake and event multiplier", () => {
    // Only the metals line is braked; ore's own (civilian-only) draw is untouched, and the
    // draw on ore falls by exactly the metals gate — the per-consumer application the
    // matcher's severity ordering depends on.
    const use = useRatesByGood(makeInput(1));
    const gated: DrawRateInput = {
      ...makeInput(1),
      brakeCeilingOf: (goodId) => (goodId === "metals" ? 0.25 : 1),
      productionMultOf: (goodId) => (goodId === "metals" ? 0.5 : 1),
    };
    const draw = drawRatesByGood(gated);
    const oreUse = requireUse(use, "ore");
    expect(requireDraw(draw, "ore")).toBeCloseTo(oreUse.civilian + oreUse.industrial * 0.25 * 0.5, 9);
    // `metals` is consumed by no local factory here, so its draw is civilian-only either way.
    expect(requireDraw(draw, "metals")).toBeCloseTo(requireUse(use, "metals").total, 9);
  });

  it("reads a non-finite brake or multiplier as ungated", () => {
    const nonFinite: DrawRateInput = {
      ...makeInput(1),
      brakeCeilingOf: () => Number.NaN,
      productionMultOf: () => Number.POSITIVE_INFINITY,
    };
    const draw = drawRatesByGood(nonFinite);
    const use = useRatesByGood(makeInput(1));
    for (const goodId of GOOD_NAMES) {
      expect(requireDraw(draw, goodId)).toBeCloseTo(requireUse(use, goodId).total, 9);
    }
  });
});
