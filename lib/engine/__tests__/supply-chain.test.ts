import { describe, it, expect } from "vitest";
import { inputGate, simulateSystemEconomyTick, simulateCoupledEconomyTick } from "@/lib/engine/supply-chain";
import type { MarketTickEntry, EconomySimParams } from "@/lib/engine/tick";

const PARAMS: EconomySimParams = { holdCover: 1.3 };

// Convenience: build a full MarketTickEntry with per-entry band defaults.
function entry(
  goodId: string,
  stock: number,
  prod?: number,
  cons?: number,
  minStock = 5,
  maxStock = 200,
  targetStock = 100,
): MarketTickEntry {
  return { goodId, stock, minStock, targetStock, maxStock, productionRate: prod, consumptionRate: cons };
}

describe("inputGate", () => {
  it("is 1 for a tier-0 good (no recipe)", () => {
    expect(inputGate("ore", 10, () => 100, () => 5)).toBe(1);
  });

  it("is 1 when the input is abundant", () => {
    // metals recipe { ore: 1 }; effectiveProduction 10 wants 10 ore; 200 ore available.
    expect(inputGate("metals", 10, () => 200, () => 5)).toBe(1);
  });

  it("throttles proportionally when the input is scarce (above-floor drawable)", () => {
    // want 10 ore; stock 8 ⇒ drawable 3 (8 - floor 5) ⇒ gate 0.3
    expect(inputGate("metals", 10, () => 8, () => 5)).toBeCloseTo(0.3, 6);
  });

  it("binds on the scarcest of multiple inputs", () => {
    // chemicals { gas: 0.5, minerals: 0.5 }; eff 10 ⇒ wants 5 gas, 5 minerals.
    const stock = (g: string) => (g === "gas" ? 200 : 6); // minerals drawable 1 ⇒ ratio 0.2
    expect(inputGate("chemicals", 10, stock, () => 5)).toBeCloseTo(0.2, 6);
  });

  it("is 0 when the input sits exactly at the floor (nothing drawable)", () => {
    // stock === minLevel ⇒ drawable 0 ⇒ gate 0; production fully starved.
    expect(inputGate("metals", 10, () => 5, () => 5)).toBe(0);
  });

  it("respects a per-input floor higher than 5 when minStockOf returns it", () => {
    // ore has floor 20; stock 25 ⇒ drawable 5; want 10 ⇒ gate 0.5
    expect(inputGate("metals", 10, () => 25, () => 20)).toBeCloseTo(0.5, 6);
  });
});

describe("simulateSystemEconomyTick", () => {
  it("never breaches the floor when draining a scarce input", () => {
    // ore near floor, a metals producer wanting more than is drawable.
    const out = simulateSystemEconomyTick(
      [entry("ore", 6), entry("metals", 50, 20)],
      PARAMS,
    );
    const ore = out.find((e) => e.goodId === "ore")!;
    expect(ore.stock).toBeGreaterThanOrEqual(5);
  });

  it("propagates a fresh tier-0 output to its tier-1 consumer the same tick", () => {
    // ore starts AT floor (5, nothing drawable yet) but produces this tick;
    // metals should still get some ore because ore is processed first (topo order).
    const out = simulateSystemEconomyTick(
      [entry("metals", 50, 10), entry("ore", 5, 30)],
      PARAMS,
    );
    const metals = out.find((e) => e.goodId === "metals")!;
    // ore produced 30 (self-limited) before metals draws ⇒ metals output > 0.
    expect(metals.stock).toBeGreaterThan(50);
  });

  it("leaves a no-recipe, no-producer good driven only by consumption", () => {
    const out = simulateSystemEconomyTick([entry("water", 100, undefined, 8)], PARAMS);
    expect(out[0].stock).toBeLessThan(100);
  });

  it("returns entries in the input order regardless of processing order", () => {
    const out = simulateSystemEconomyTick(
      [entry("metals", 50, 5), entry("ore", 100, 5)],
      PARAMS,
    );
    expect(out.map((e) => e.goodId)).toEqual(["metals", "ore"]);
  });

  it("keeps a shared scarce input above the floor across two same-tick consumers", () => {
    // chemicals { gas, minerals } and components { minerals, metals } both draw
    // minerals in one tick. Minerals starts just above the floor, so the second
    // consumer sees stock already drawn down by the first — the Math.max guard
    // must still keep it at/above the floor.
    const out = simulateSystemEconomyTick(
      [
        entry("minerals", 6, 0),
        entry("gas", 200, 0),
        entry("metals", 200, 0),
        entry("chemicals", 50, 10),
        entry("components", 50, 10),
      ],
      PARAMS,
    );
    const minerals = out.find((e) => e.goodId === "minerals")!;
    expect(minerals.stock).toBeGreaterThanOrEqual(5);
  });

  it("cascade: cutting ore supply throttles metals output", () => {
    const rich = simulateSystemEconomyTick([entry("ore", 150, 0), entry("metals", 50, 20)], PARAMS);
    const starved = simulateSystemEconomyTick([entry("ore", 6, 0), entry("metals", 50, 20)], PARAMS);
    const richMetals = rich.find((e) => e.goodId === "metals")!.stock;
    const starvedMetals = starved.find((e) => e.goodId === "metals")!.stock;
    expect(starvedMetals).toBeLessThan(richMetals);
  });

  // ── Per-entry band tests ─────────────────────────────────────────

  it("clamps to the PER-ENTRY band, not a global band", () => {
    // ore has a tight band [10, 50]; stock seeded above its own ceiling must clamp to 50.
    const oreEntry: MarketTickEntry = {
      goodId: "ore",
      stock: 60, // above this entry's maxStock (50)
      minStock: 10,
      targetStock: 30,
      maxStock: 50,
      productionRate: 0,
      consumptionRate: 0,
    };
    const out = simulateSystemEconomyTick([oreEntry], PARAMS);
    expect(out[0].stock).toBe(50); // clamped down to the per-entry ceiling
  });

  it("input draw respects the INPUT good's own per-entry floor (different minStocks)", () => {
    // ore has minStock=20, metals has minStock=5.
    // ore stock is 25 (only 5 drawable). metals wants 10 ore per unit output.
    // effectiveProduction=10 ⇒ desired draw 10 ⇒ gate=5/10=0.5.
    // ore must not drop below 20.
    const oreEntry: MarketTickEntry = {
      goodId: "ore",
      stock: 25,
      minStock: 20,
      targetStock: 100,
      maxStock: 200,
      productionRate: 0,
    };
    const metalsEntry: MarketTickEntry = {
      goodId: "metals",
      stock: 50,
      minStock: 5,
      targetStock: 100,
      maxStock: 200,
      productionRate: 10,
    };
    const out = simulateSystemEconomyTick([oreEntry, metalsEntry], PARAMS);
    const oreOut = out.find((e) => e.goodId === "ore")!;
    expect(oreOut.stock).toBeGreaterThanOrEqual(20); // never breaches ore's own floor
  });
});

describe("simulateSystemEconomyTick — operating ceiling", () => {
  it("idles production at the operating ceiling in the coupled tick", () => {
    // tier-0 good (no recipe) → input gate 1. holdCover 1.3 × targetStock 100 = 130.
    const out = simulateSystemEconomyTick(
      [{ goodId: "ore", stock: 130, minStock: 5, targetStock: 100, maxStock: 200, productionRate: 10 }],
      PARAMS,
    );
    expect(out[0].stock).toBeCloseTo(130, 5); // throttled to ~0 at the operating ceiling
  });
});

describe("simulateSystemEconomyTick — realized output", () => {
  it("reports realized output per entry — input-starved production realizes less than capacity", () => {
    // ore: tier-0 (no recipe), stock pinned at its own floor so the operating-ceiling
    // factor is 1 → realized should equal effectiveProduction exactly (gate is always
    // 1 for a no-recipe good).
    const tier0 = entry("ore", 5, 20);
    // chemicals: recipe { gas: 0.5, minerals: 0.5 }; neither input is in this entry set,
    // so stockOf/minStockOf both default to 0 for them ⇒ drawable 0 ⇒ gate 0 ⇒ realized 0.
    const starved = entry("chemicals", 50, 20);
    // water: pure consumer, no productionRate at all ⇒ never enters the production
    // branch ⇒ realized reports 0, not undefined.
    const consumerOnly = entry("water", 100, undefined, 8);

    const simulated = simulateSystemEconomyTick([tier0, starved, consumerOnly], PARAMS);
    const tier0Result = simulated.find((e) => e.goodId === "ore")!;
    const starvedResult = simulated.find((e) => e.goodId === "chemicals")!;
    const consumerResult = simulated.find((e) => e.goodId === "water")!;

    expect(tier0Result.realized).toBeCloseTo(20, 6);
    expect(starvedResult.realized).toBe(0);
    expect(consumerResult.realized).toBe(0);
  });
});

describe("simulateCoupledEconomyTick", () => {
  it("isolates systems — system A's ore does not feed system B's metals", () => {
    // A: ore-rich + metals. B: ore-starved + metals. Same flat array.
    const entries: MarketTickEntry[] = [
      { goodId: "ore", stock: 150, minStock: 5, targetStock: 100, maxStock: 200, productionRate: 0 },   // A
      { goodId: "metals", stock: 50, minStock: 5, targetStock: 100, maxStock: 200, productionRate: 20 }, // A
      { goodId: "ore", stock: 6, minStock: 5, targetStock: 100, maxStock: 200, productionRate: 0 },      // B
      { goodId: "metals", stock: 50, minStock: 5, targetStock: 100, maxStock: 200, productionRate: 20 }, // B
    ];
    const systemIds = ["A", "A", "B", "B"];
    const out = simulateCoupledEconomyTick(entries, systemIds, PARAMS);
    expect(out.map((e) => e.goodId)).toEqual(["ore", "metals", "ore", "metals"]);
    const aMetals = out[1].stock;
    const bMetals = out[3].stock;
    expect(bMetals).toBeLessThan(aMetals); // B starved ⇒ less metals
  });
});
