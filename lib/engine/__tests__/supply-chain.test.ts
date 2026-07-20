import { describe, it, expect } from "vitest";
import {
  inputGate,
  inputDrawRatio,
  simulateSystemEconomyTick,
  simulateCoupledEconomyTick,
} from "@/lib/engine/supply-chain";
import type { MarketTickEntry, EconomySimParams } from "@/lib/engine/tick";

const PARAMS: EconomySimParams = { holdCover: 1.3, comfortCover: 0.75 };

// Convenience: build a full MarketTickEntry with per-entry band defaults.
// minStock is left on the entry (0.05×T here) but the engine no longer floors on
// it — it is retained only for the decay-uptake band read.
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

  it("is 1 when the input is abundant (above comfort and above desired)", () => {
    // metals recipe { ore: 1 }; effectiveProduction 10 wants 10 ore; 200 ore available.
    expect(inputGate("metals", 10, () => 200, () => 5)).toBe(1);
  });
});

describe("inputDrawRatio", () => {
  it("is 1 when nothing is desired", () => {
    expect(inputDrawRatio(50, 100, 0)).toBe(1);
  });

  it("is 1 at/above comfort when the desired draw fits in stock", () => {
    // comfort 75, stock 100 (≥ comfort), desired 10 (≤ stock) ⇒ unconstrained.
    expect(inputDrawRatio(100, 75, 10)).toBe(1);
  });

  it("rations on the sqrt ramp below comfort", () => {
    // stock 25 = 0.25 × comfort 100 ⇒ ramp √0.25 = 0.5; desired 10 leaves 5 ≤ stock ⇒ ratio 0.5.
    expect(inputDrawRatio(25, 100, 10)).toBeCloseTo(0.5, 6);
  });

  it("caps on the physical stock when the ramp would over-draw", () => {
    // stock 2, comfort 4 ⇒ ramp √0.5 ≈ 0.707; ramp×desired = 7.07 > stock 2 ⇒ availability binds: 2/10 = 0.2.
    expect(inputDrawRatio(2, 4, 10)).toBeCloseTo(0.2, 6);
  });

  it("never exceeds 1", () => {
    // abundant stock, tiny desired ⇒ clamped to 1, not stock/desired.
    expect(inputDrawRatio(1000, 10, 5)).toBe(1);
  });

  it("delivers freely with a non-positive comfort band when any stock exists, 0 at empty", () => {
    expect(inputDrawRatio(50, 0, 10)).toBe(1);
    expect(inputDrawRatio(0, 0, 10)).toBe(0);
  });
});

describe("inputGate — scarcity ramp", () => {
  it("gates at 1 when every input sits at/above its comfort stock", () => {
    // metals { ore: 1 }; desired 10 fits in stock at comfort (75) and above (200).
    expect(inputGate("metals", 10, () => 75, () => 75)).toBe(1);
    expect(inputGate("metals", 10, () => 200, () => 75)).toBe(1);
  });

  it("rations an input below comfort at the shared consumptionFactor rate", () => {
    // input stock 25 = 0.25 × comfort 100 ⇒ ramp √0.25 = 0.5; desired 10 ⇒ allowed 5 ≤ stock ⇒ gate 0.5.
    expect(inputGate("metals", 10, () => 25, () => 100)).toBeCloseTo(0.5, 6);
  });

  it("binds on the scarcest input on the ramp", () => {
    // chemicals { gas: 0.5, minerals: 0.5 }; eff 10 ⇒ 5 each. gas abundant (ratio 1),
    // minerals 25 = 0.25 × comfort 100 ⇒ ramp 0.5 ⇒ gate 0.5.
    const stock = (g: string) => (g === "gas" ? 200 : 25);
    expect(inputGate("chemicals", 10, stock, () => 100)).toBeCloseTo(0.5, 6);
  });

  it("draws below the old minStock — a crisis drains toward empty, not to the floor", () => {
    // ore starts at 3 (between 0 and the old minStock 5); a metals producer draws it.
    const out = simulateSystemEconomyTick([entry("ore", 3), entry("metals", 50, 20)], PARAMS);
    const ore = out.find((e) => e.goodId === "ore")!;
    const metals = out.find((e) => e.goodId === "metals")!;
    // Output realized despite scarcity, and the input drained toward empty past the old floor.
    expect(metals.stock).toBeGreaterThan(50);
    expect(ore.stock).toBeLessThan(3);
    expect(ore.stock).toBeLessThan(5); // below the old minStock — no reserve floor
    expect(ore.stock).toBeCloseTo(0, 6);
  });

  it("never draws an input negative", () => {
    // Huge desired vs a tiny stock: the availability cap keeps the draw ≤ stock.
    const out = simulateSystemEconomyTick([entry("ore", 2), entry("metals", 50, 1000)], PARAMS);
    const ore = out.find((e) => e.goodId === "ore")!;
    const metals = out.find((e) => e.goodId === "metals")!;
    expect(ore.stock).toBeGreaterThanOrEqual(0);
    expect(ore.stock).toBeCloseTo(0, 6);
    expect(metals.stock).toBeGreaterThan(50);
  });
});

describe("simulateSystemEconomyTick", () => {
  it("propagates a fresh tier-0 output to its tier-1 consumer the same tick", () => {
    // ore starts low but produces this tick; metals should still get some ore because
    // ore is processed first (topo order).
    const out = simulateSystemEconomyTick(
      [entry("metals", 50, 10), entry("ore", 5, 30)],
      PARAMS,
    );
    const metals = out.find((e) => e.goodId === "metals")!;
    // ore produced 30 before metals draws ⇒ metals output > 0.
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

  it("keeps a shared scarce input non-negative across two same-tick consumers", () => {
    // chemicals { gas, minerals } and components { minerals, metals } both draw
    // minerals in one tick. Minerals starts just above 0, so the second consumer
    // sees stock already drawn down by the first — the Math.max(0, …) guard must
    // still keep it non-negative (the old reserve floor is gone).
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
    expect(minerals.stock).toBeGreaterThanOrEqual(0);
    expect(minerals.stock).toBeLessThan(5); // drained below the old floor
  });

  it("cascade: cutting ore supply throttles metals output", () => {
    const rich = simulateSystemEconomyTick([entry("ore", 150, 0), entry("metals", 50, 20)], PARAMS);
    const starved = simulateSystemEconomyTick([entry("ore", 6, 0), entry("metals", 50, 20)], PARAMS);
    const richMetals = rich.find((e) => e.goodId === "metals")!.stock;
    const starvedMetals = starved.find((e) => e.goodId === "metals")!.stock;
    expect(starvedMetals).toBeLessThan(richMetals);
  });

  // ── Per-entry band tests ─────────────────────────────────────────

  it("clamps to the PER-ENTRY maxStock, not a global band", () => {
    // ore has a tight ceiling (50); stock seeded above its own ceiling must clamp to 50.
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

  it("input draw ignores the INPUT good's old minStock — drains on the comfort ramp", () => {
    // ore has minStock=20; the engine no longer treats it as a draw floor.
    // ore stock 25, comfort 0.75×100 = 75 ⇒ ramp √(25/75) ≈ 0.577; metals wants 10 ore.
    // The draw pulls ore below its old floor of 20 — never to it.
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
    expect(oreOut.stock).toBeLessThan(20); // below the old per-input floor
    expect(oreOut.stock).toBeGreaterThanOrEqual(0);
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
    // ore: tier-0 (no recipe), stock below the anchor so the production ceiling is 1 →
    // realized equals effectiveProduction exactly (gate is always 1 for a no-recipe good).
    const tier0 = entry("ore", 5, 20);
    // chemicals: recipe { gas: 0.5, minerals: 0.5 }; neither input is in this entry set,
    // so stockOf defaults to 0 and comfortOf defaults to 0 ⇒ ramp 0 ⇒ gate 0 ⇒ realized 0.
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

describe("simulateSystemEconomyTick — delivered flow", () => {
  it("reports delivered = full demand above the comfort knee", () => {
    // water at stock 100 ≥ comfort (0.75×100 = 75) ⇒ full delivery = effectiveConsumption.
    const out = simulateSystemEconomyTick([entry("water", 100, undefined, 8)], PARAMS);
    const water = out.find((e) => e.goodId === "water")!;
    expect(water.delivered).toBeCloseTo(8, 6);
    expect(water.stock).toBeCloseTo(92, 6);
  });

  it("reports rationed delivered below the knee and 0 at empty", () => {
    // below the knee: stock 18.75 = 0.25 × comfort 75 ⇒ ramp 0.5 ⇒ delivered 8×0.5 = 4.
    const below = simulateSystemEconomyTick([entry("water", 18.75, undefined, 8)], PARAMS);
    expect(below.find((e) => e.goodId === "water")!.delivered).toBeCloseTo(4, 6);
    // at empty: nothing to deliver.
    const empty = simulateSystemEconomyTick([entry("water", 0, undefined, 8)], PARAMS);
    expect(empty.find((e) => e.goodId === "water")!.delivered).toBe(0);
  });

  it("reports delivered = 0 for pure producers", () => {
    const out = simulateSystemEconomyTick([entry("ore", 5, 20)], PARAMS);
    expect(out.find((e) => e.goodId === "ore")!.delivered).toBe(0);
  });

  it("clamps post-tick stock to [0, maxStock] (no minStock floor)", () => {
    // lower bound is 0, not minStock: a consumer drains water past its old floor (5).
    const drained = simulateSystemEconomyTick([entry("water", 4, undefined, 8)], PARAMS);
    const water = drained.find((e) => e.goodId === "water")!;
    expect(water.stock).toBeLessThan(5); // below the old minStock floor
    expect(water.stock).toBeGreaterThan(0);
    expect(water.stock).toBeCloseTo(2.1525, 3);
    // upper bound is maxStock: stock seeded above the ceiling clamps down.
    const over = simulateSystemEconomyTick([entry("ore", 250)], PARAMS);
    expect(over.find((e) => e.goodId === "ore")!.stock).toBe(200);
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
