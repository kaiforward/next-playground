import { describe, it, expect } from "vitest";
import { calculatePrice } from "../pricing";

describe("calculatePrice", () => {
  it("returns base price when supply equals demand", () => {
    const price = calculatePrice(100, 50, 50);
    expect(price).toBe(100);
  });

  it("returns higher price when demand > supply", () => {
    const price = calculatePrice(100, 50, 100);
    expect(price).toBe(200);
  });

  it("returns lower price when supply > demand", () => {
    const price = calculatePrice(100, 100, 50);
    expect(price).toBe(50);
  });

  it("clamps to max 5x base price", () => {
    // demand/supply ratio = 10, so raw = 1000, clamped to 500
    const price = calculatePrice(100, 10, 100);
    expect(price).toBe(500);
  });

  it("clamps to min 0.2x base price", () => {
    // demand/supply ratio = 0.05, so raw = 5, clamped to 20
    const price = calculatePrice(100, 100, 5);
    expect(price).toBe(20);
  });

  it("returns max price when supply is 0", () => {
    const price = calculatePrice(100, 0, 50);
    expect(price).toBe(500);
  });

  it("returns max price when supply is negative", () => {
    const price = calculatePrice(100, -10, 50);
    expect(price).toBe(500);
  });

  describe("custom clamps", () => {
    it("uses custom minMult", () => {
      // demand/supply = 0.05, raw = 5, custom min = 0.1*100 = 10
      const price = calculatePrice(100, 100, 5, 0.1, 5.0);
      expect(price).toBe(10);
    });

    it("uses custom maxMult", () => {
      // demand/supply = 10, raw = 1000, custom max = 8.0*100 = 800
      const price = calculatePrice(100, 10, 100, 0.2, 8.0);
      expect(price).toBe(800);
    });

    it("uses custom maxMult when supply is 0", () => {
      const price = calculatePrice(100, 0, 50, 0.1, 4.0);
      expect(price).toBe(400);
    });

    it("tier 0 goods have wider range than tier 2", () => {
      // Tier 0 clamps: 0.1x - 8.0x (water base 25, food 30, ore/textiles 35)
      const tier0Low = calculatePrice(25, 200, 1, 0.1, 8.0);
      expect(tier0Low).toBe(3); // 0.1 * 25 rounded
      const tier0High = calculatePrice(25, 1, 200, 0.1, 8.0);
      expect(tier0High).toBe(200); // 8.0 * 25

      // Tier 2 clamps: 0.2x - 4.0x (electronics/machinery/weapons)
      const tier2Low = calculatePrice(100, 200, 1, 0.2, 4.0);
      expect(tier2Low).toBe(20); // 0.2 * 100
      const tier2High = calculatePrice(100, 1, 200, 0.2, 4.0);
      expect(tier2High).toBe(400); // 4.0 * 100
    });

    it("defaults match legacy behavior (0.2x - 5.0x)", () => {
      const withDefaults = calculatePrice(100, 10, 100);
      const explicit = calculatePrice(100, 10, 100, 0.2, 5.0);
      expect(withDefaults).toBe(explicit);
    });
  });
});
