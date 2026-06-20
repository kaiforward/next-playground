import { describe, it, expect } from "vitest";
import { inputGate, simulateSystemEconomyTick } from "@/lib/engine/supply-chain";
import type { MarketTickEntry, EconomySimParams } from "@/lib/engine/tick";

const PARAMS: EconomySimParams = { noiseAmplitude: 0, minLevel: 5, maxLevel: 200 };
const noRng = () => 0.5; // noise = 0 when amplitude 0

describe("inputGate", () => {
  it("is 1 for a tier-0 good (no recipe)", () => {
    expect(inputGate("ore", 10, () => 100, 5)).toBe(1);
  });

  it("is 1 when the input is abundant", () => {
    // metals recipe { ore: 1 }; effectiveProduction 10 wants 10 ore; 200 ore available.
    expect(inputGate("metals", 10, () => 200, 5)).toBe(1);
  });

  it("throttles proportionally when the input is scarce (above-floor drawable)", () => {
    // want 10 ore; stock 8 ⇒ drawable 3 ⇒ gate 0.3
    expect(inputGate("metals", 10, () => 8, 5)).toBeCloseTo(0.3, 6);
  });

  it("binds on the scarcest of multiple inputs", () => {
    // chemicals { gas: 0.5, minerals: 0.5 }; eff 10 ⇒ wants 5 gas, 5 minerals.
    const stock = (g: string) => (g === "gas" ? 200 : 6); // minerals drawable 1 ⇒ ratio 0.2
    expect(inputGate("chemicals", 10, stock, 5)).toBeCloseTo(0.2, 6);
  });
});

describe("simulateSystemEconomyTick", () => {
  function entry(goodId: string, stock: number, prod?: number, cons?: number): MarketTickEntry {
    return { goodId, stock, productionRate: prod, consumptionRate: cons };
  }

  it("never breaches the floor when draining a scarce input", () => {
    // ore near floor, a metals producer wanting more than is drawable.
    const out = simulateSystemEconomyTick(
      [entry("ore", 6, undefined, undefined), entry("metals", 50, 20, undefined)],
      PARAMS,
      noRng,
    );
    const ore = out.find((e) => e.goodId === "ore")!;
    expect(ore.stock).toBeGreaterThanOrEqual(5);
  });

  it("propagates a fresh tier-0 output to its tier-1 consumer the same tick", () => {
    // ore starts AT floor (5, nothing drawable yet) but produces this tick;
    // metals should still get some ore because ore is processed first (topo order).
    const out = simulateSystemEconomyTick(
      [entry("metals", 50, 10, undefined), entry("ore", 5, 30, undefined)],
      PARAMS,
      noRng,
    );
    const metals = out.find((e) => e.goodId === "metals")!;
    // ore produced 30 (self-limited) before metals draws ⇒ metals output > 0.
    expect(metals.stock).toBeGreaterThan(50);
  });

  it("leaves a no-recipe, no-producer good driven only by consumption", () => {
    const out = simulateSystemEconomyTick([entry("water", 100, undefined, 8)], PARAMS, noRng);
    expect(out[0].stock).toBeLessThan(100);
  });

  it("returns entries in the input order regardless of processing order", () => {
    const out = simulateSystemEconomyTick(
      [entry("metals", 50, 5), entry("ore", 100, 5)],
      PARAMS,
      noRng,
    );
    expect(out.map((e) => e.goodId)).toEqual(["metals", "ore"]);
  });

  it("cascade: cutting ore supply throttles metals output", () => {
    const rich = simulateSystemEconomyTick([entry("ore", 150, 0), entry("metals", 50, 20)], PARAMS, noRng);
    const starved = simulateSystemEconomyTick([entry("ore", 6, 0), entry("metals", 50, 20)], PARAMS, noRng);
    const richMetals = rich.find((e) => e.goodId === "metals")!.stock;
    const starvedMetals = starved.find((e) => e.goodId === "metals")!.stock;
    expect(starvedMetals).toBeLessThan(richMetals);
  });
});
