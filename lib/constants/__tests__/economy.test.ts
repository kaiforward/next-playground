import { describe, it, expect } from "vitest";
import { getConsumeEquilibrium, SELF_SUFFICIENCY } from "../economy";
import { ECONOMY_CONSUMPTION } from "../universe";
import { GOODS } from "../goods";
import type { EconomyType } from "@/lib/types/game";

const ECONOMY_TYPES: EconomyType[] = [
  "agricultural", "extraction", "refinery", "industrial", "tech", "core",
];

describe("getConsumeEquilibrium", () => {
  it("returns the base consume level when self-sufficiency is 0", () => {
    // Tech consuming luxuries has s=0.0
    const eq = GOODS.luxuries.equilibrium;
    const result = getConsumeEquilibrium("tech", "luxuries", eq);
    expect(result).toBe(eq.consumes);
  });

  it("returns the base consume level for goods not in SELF_SUFFICIENCY", () => {
    // A good not listed in the economy type's map should default to s=0
    const eq = GOODS.weapons.equilibrium;
    const result = getConsumeEquilibrium("agricultural", "weapons", eq);
    expect(result).toBe(eq.consumes);
  });

  it("blends toward the producer level with positive self-sufficiency", () => {
    // Agricultural consuming water: s=0.5 -> 110 + 0.5 * (160 - 110) = 135
    const eq = GOODS.water.equilibrium;
    const result = getConsumeEquilibrium("agricultural", "water", eq);
    expect(result).toBe(135);
    // Between the consumer and producer seed levels
    expect(result).toBeGreaterThan(eq.consumes);
    expect(result).toBeLessThan(eq.produces);
  });

  it("returns integer values", () => {
    for (const econ of ECONOMY_TYPES) {
      const consumed = Object.keys(SELF_SUFFICIENCY[econ]);
      for (const goodId of consumed) {
        const goodDef = GOODS[goodId];
        if (!goodDef) continue;
        const result = getConsumeEquilibrium(econ, goodId, goodDef.equilibrium);
        expect(Number.isInteger(result)).toBe(true);
      }
    }
  });

  it("stays between the consumer and producer seed levels", () => {
    for (const econ of ECONOMY_TYPES) {
      const consumed = Object.keys(SELF_SUFFICIENCY[econ]);
      for (const goodId of consumed) {
        const goodDef = GOODS[goodId];
        if (!goodDef) continue;
        const result = getConsumeEquilibrium(econ, goodId, goodDef.equilibrium);
        const { produces, consumes } = goodDef.equilibrium;
        // Blends from consumes toward produces (always upward with s >= 0)
        expect(result).toBeGreaterThanOrEqual(consumes);
        expect(result).toBeLessThanOrEqual(produces);
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
      for (const factor of Object.values(SELF_SUFFICIENCY[econ])) {
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
