import { describe, it, expect } from "vitest";
import { getConsumeEquilibrium, SELF_SUFFICIENCY } from "../economy";
import { ECONOMY_CONSUMPTION } from "../universe";
import { GOODS } from "../goods";
import type { EconomyType } from "@/lib/types/game";

const ECONOMY_TYPES: EconomyType[] = [
  "agricultural", "extraction", "refinery", "industrial", "tech", "core",
];

describe("getConsumeEquilibrium", () => {
  it("returns base consume targets when self-sufficiency is 0", () => {
    // Tech consuming luxuries has s=0.0
    const eq = GOODS.luxuries.equilibrium;
    const result = getConsumeEquilibrium("tech", "luxuries", eq);
    expect(result).toEqual(eq.consumes);
  });

  it("returns base consume targets for goods not in SELF_SUFFICIENCY", () => {
    // A good not listed in the economy type's map should default to s=0
    const eq = GOODS.weapons.equilibrium;
    const result = getConsumeEquilibrium("agricultural", "weapons", eq);
    expect(result).toEqual(eq.consumes);
  });

  it("blends toward producer targets with positive self-sufficiency", () => {
    // Agricultural consuming water: s=0.5
    const eq = GOODS.water.equilibrium;
    const result = getConsumeEquilibrium("agricultural", "water", eq);

    // supply = 110 + 0.5 * (160 - 110) = 110 + 25 = 135
    expect(result.supply).toBe(135);
    // demand = 116 - 0.5 * (116 - 136) = 116 + 10 = 126
    expect(result.demand).toBe(126);

    // Supply should be between consume and produce targets
    expect(result.supply).toBeGreaterThan(eq.consumes.supply);
    expect(result.supply).toBeLessThan(eq.produces.supply);
  });

  it("returns integer values", () => {
    for (const econ of ECONOMY_TYPES) {
      const consumed = Object.keys(SELF_SUFFICIENCY[econ]);
      for (const goodId of consumed) {
        const goodDef = GOODS[goodId];
        if (!goodDef) continue;
        const result = getConsumeEquilibrium(econ, goodId, goodDef.equilibrium);
        expect(Number.isInteger(result.supply)).toBe(true);
        expect(Number.isInteger(result.demand)).toBe(true);
      }
    }
  });

  it("supply stays between consumer and producer targets", () => {
    for (const econ of ECONOMY_TYPES) {
      const consumed = Object.keys(SELF_SUFFICIENCY[econ]);
      for (const goodId of consumed) {
        const goodDef = GOODS[goodId];
        if (!goodDef) continue;
        const result = getConsumeEquilibrium(econ, goodId, goodDef.equilibrium);
        const { produces, consumes } = goodDef.equilibrium;

        // Supply blends from consumes toward produces (always upward)
        expect(result.supply).toBeGreaterThanOrEqual(consumes.supply);
        expect(result.supply).toBeLessThanOrEqual(produces.supply);

        // Demand blends between the two values (direction depends on per-good targets)
        const minDemand = Math.min(produces.demand, consumes.demand);
        const maxDemand = Math.max(produces.demand, consumes.demand);
        expect(result.demand).toBeGreaterThanOrEqual(minDemand);
        expect(result.demand).toBeLessThanOrEqual(maxDemand);
      }
    }
  });
});

describe("SELF_SUFFICIENCY data integrity", () => {
  it("only contains goods that the economy type actually consumes", () => {
    for (const econ of ECONOMY_TYPES) {
      const consumedGoods = Object.keys(ECONOMY_CONSUMPTION[econ]);
      const selfSuffGoods = Object.keys(SELF_SUFFICIENCY[econ]);
      for (const goodId of selfSuffGoods) {
        expect(consumedGoods).toContain(goodId);
      }
    }
  });

  it("has factors in [0, 1] range", () => {
    for (const econ of ECONOMY_TYPES) {
      for (const [goodId, factor] of Object.entries(SELF_SUFFICIENCY[econ])) {
        expect(factor).toBeGreaterThanOrEqual(0);
        expect(factor).toBeLessThanOrEqual(1);
      }
    }
  });

  it("covers all consumed goods for every economy type", () => {
    // Every consumed good should have an entry (even if 0.0)
    for (const econ of ECONOMY_TYPES) {
      const consumedGoods = Object.keys(ECONOMY_CONSUMPTION[econ]);
      const selfSuffGoods = Object.keys(SELF_SUFFICIENCY[econ]);
      for (const goodId of consumedGoods) {
        expect(selfSuffGoods).toContain(goodId);
      }
    }
  });
});
