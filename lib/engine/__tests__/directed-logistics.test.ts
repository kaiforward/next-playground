import { describe, it, expect } from "vitest";
import {
  systemLogisticsGeneration,
  matchFactionTransfers,
  classifyMarketState,
  surplusDrawable,
  type SystemLogisticsState,
  type RouteCost,
} from "@/lib/engine/directed-logistics";
import { DIRECTED_LOGISTICS } from "@/lib/constants/directed-logistics";

describe("classifyMarketState", () => {
  it("classifies below the deficit fraction as deficit with shortfall to target", () => {
    // targetStock 10, DEFICIT_FRACTION 0.8 → threshold 8; stock 2 < 8.
    const c = classifyMarketState(2, 10);
    expect(c.kind).toBe("deficit");
    expect(c.shortfall).toBe(8);
    expect(c.drawable).toBe(0);
  });

  it("classifies at/above the surplus margin as surplus with drawable above target", () => {
    // targetStock 50, SURPLUS_MARGIN 1.4 → threshold 70; stock 100 ≥ 70.
    const c = classifyMarketState(100, 50);
    expect(c.kind).toBe("surplus");
    expect(c.drawable).toBe(50);
    expect(c.shortfall).toBe(0);
  });

  it("classifies the dead-band between thresholds as balanced", () => {
    // targetStock 10 → deficit < 8, surplus ≥ 14; stock 10 is between.
    const c = classifyMarketState(10, 10);
    expect(c.kind).toBe("balanced");
    expect(c.shortfall).toBe(0);
    expect(c.drawable).toBe(0);
  });

  it("never reports a negative shortfall or drawable", () => {
    expect(classifyMarketState(0, 0).kind).toBe("balanced");
    expect(classifyMarketState(7.9, 10).shortfall).toBeCloseTo(2.1);
  });

  it("classifies a zero-anchor good (targetStock 0, positive stock) as balanced, not surplus", () => {
    const c = classifyMarketState(50, 0);
    expect(c.kind).toBe("balanced");
    expect(c.drawable).toBe(0);
  });
});

describe("systemLogisticsGeneration", () => {
  it("scales linearly with population", () => {
    expect(systemLogisticsGeneration(100)).toBeCloseTo(100 * DIRECTED_LOGISTICS.GENERATION_PER_POP);
  });
  it("never negative (clamps negative population to 0)", () => {
    expect(systemLogisticsGeneration(-5)).toBe(0);
  });
});

// Helper: a system with one good's market state. `production` defaults to 0 (pure
// consumer) so existing cases are unaffected; the net-producer gate cases set it.
function sys(
  systemId: string,
  generation: number,
  good: { goodId: string; stock: number; targetStock: number; demand: number; production?: number },
): SystemLogisticsState {
  return { systemId, factionId: "f1", generation, goods: [{ ...good, production: good.production ?? 0 }] };
}

// Unit cost = hops; 1 hop between any two systems, unreachable for "far".
const oneHop: RouteCost = (_from, to) => (to === "far" ? null : 1);

describe("matchFactionTransfers", () => {
  it("moves drawable surplus to a below-anchor deficit", () => {
    // A: stock 100 ≥ targetStock 50 × 1.4 = 70 ✓ surplus; drawable = 100 − 50 = 50
    // B: stock 2 < targetStock 10 × 0.8 = 8 ✓ deficit; shortfall = 10 − 2 = 8
    // qty = min(8, 50, budget 100) = 8; cost = 8
    const surplus = sys("A", 100, { goodId: "food", stock: 100, targetStock: 50, demand: 5 });
    const deficit = sys("B", 0, { goodId: "food", stock: 2, targetStock: 10, demand: 5 });
    const { transfers } = matchFactionTransfers([surplus, deficit], oneHop);
    expect(transfers).toHaveLength(1);
    expect(transfers[0]).toMatchObject({ goodId: "food", fromSystemId: "A", toSystemId: "B" });
    expect(transfers[0].quantity).toBe(8);
    expect(transfers[0].cost).toBe(8); // quantity × 1 hop
  });

  it("never draws a source below its own target", () => {
    // A: stock 12 ≥ targetStock 8 × 1.4 = 11.2 ✓ surplus; drawable = 12 − 8 = 4
    // B: stock 0 < targetStock 10 × 0.8 = 8 ✓ deficit; shortfall = 10 − 0 = 10
    // qty = min(10, 4, budget 100) = 4 — donor draws down to its own target (8), not below it
    const surplus = sys("A", 100, { goodId: "food", stock: 12, targetStock: 8, demand: 5 });
    const deficit = sys("B", 0, { goodId: "food", stock: 0, targetStock: 10, demand: 5 });
    const { transfers } = matchFactionTransfers([surplus, deficit], oneHop);
    expect(transfers[0].quantity).toBe(4); // drawable = 12 - 8 (target)
  });

  it("is bounded by the faction budget (under-serves, leaving residual)", () => {
    // A: stock 100 ≥ targetStock 50 × 1.4 = 70 ✓ surplus; budget = 3 → at most 3 moved
    const surplus = sys("A", 3, { goodId: "food", stock: 100, targetStock: 50, demand: 5 });
    const deficit = sys("B", 0, { goodId: "food", stock: 0, targetStock: 10, demand: 5 });
    // budget = 3 (only A generates), cost 1/unit → at most 3 moved despite a shortfall of 10
    const { transfers } = matchFactionTransfers([surplus, deficit], oneHop);
    expect(transfers[0].quantity).toBe(3);
  });

  it("ranks the most severe deficit first when budget is scarce", () => {
    // A: stock 100 ≥ targetStock 50 × 1.4 = 70 ✓ surplus
    // B mild (demand 1), C severe (demand 10) — C should be served first.
    const surplus = sys("A", 5, { goodId: "food", stock: 100, targetStock: 50, demand: 1 });
    const mild = sys("B", 0, { goodId: "food", stock: 5, targetStock: 10, demand: 1 });
    const severe = sys("C", 0, { goodId: "food", stock: 5, targetStock: 10, demand: 10 });
    const { transfers } = matchFactionTransfers([surplus, mild, severe], oneHop);
    expect(transfers[0].toSystemId).toBe("C");
  });

  it("skips unreachable deficits (route cost null)", () => {
    const surplus = sys("A", 100, { goodId: "food", stock: 100, targetStock: 50, demand: 5 });
    const deficit = sys("far", 0, { goodId: "food", stock: 0, targetStock: 10, demand: 5 });
    expect(matchFactionTransfers([surplus, deficit], oneHop).transfers).toHaveLength(0);
  });

  it("ignores goods that are neither surplus nor deficit", () => {
    // a: stock 50 < targetStock 50 × 1.4 = 70 → NOT surplus; stock 50 ≥ targetStock 50 × 0.8 = 40 → NOT deficit
    // b: same → NOT surplus, NOT deficit
    const a = sys("A", 100, { goodId: "food", stock: 50, targetStock: 50, demand: 5 });
    const b = sys("B", 0, { goodId: "food", stock: 50, targetStock: 50, demand: 5 });
    expect(matchFactionTransfers([a, b], oneHop).transfers).toHaveLength(0);
  });

  it("draws one source across two deficits without exceeding its drawable", () => {
    // A: stock 20 ≥ targetStock 10 × 1.4 = 14 ✓ surplus; drawable = 20 − 10 = 10. budget = 100.
    const surplus = sys("A", 100, { goodId: "food", stock: 20, targetStock: 10, demand: 0 });
    // C more severe (demand 10), B less severe (demand 1); each: stock 4 < 10 × 0.8 = 8 ✓ deficit, shortfall = 6.
    const severe = sys("C", 0, { goodId: "food", stock: 4, targetStock: 10, demand: 10 });
    const mild = sys("B", 0, { goodId: "food", stock: 4, targetStock: 10, demand: 1 });
    const { transfers } = matchFactionTransfers([surplus, severe, mild], oneHop);
    // C served first (severity 60 > 6): qty = min(shortfall 6, drawable 10, budget 100) = 6.
    // B served from A's residual drawable (10 - 6 = 4): qty = min(shortfall 6, drawable 4, budget 94) = 4.
    // Proves the source is not over-drawn below its own target across iterations.
    expect(transfers).toHaveLength(2);
    expect(transfers[0]).toMatchObject({ fromSystemId: "A", toSystemId: "C", quantity: 6 });
    expect(transfers[1]).toMatchObject({ fromSystemId: "A", toSystemId: "B", quantity: 4 });
  });

  it("treats a market above its anchor as a surplus even when far from any storage ceiling", () => {
    // stock 80 = 1.6× its targetStock of 50 → surplus under the anchor rule, though nowhere near a
    // storage ceiling. The near-ceiling rule (stock ≥ maxStock×0.9) missed exactly this case
    // (simulator diagnosis 2026-06-26).
    const surplus = sys("A", 100, { goodId: "food", stock: 80, targetStock: 50, demand: 5 });
    const deficit = sys("B", 0, { goodId: "food", stock: 0, targetStock: 10, demand: 5 });
    const { transfers } = matchFactionTransfers([surplus, deficit], oneHop);
    expect(transfers).toHaveLength(1);
    expect(transfers[0]).toMatchObject({ fromSystemId: "A", toSystemId: "B" });
    // shortfall = 10, drawable = 80−50 = 30, budget = 100 → qty = 10
    expect(transfers[0].quantity).toBe(10);
  });

  it("never ships a good into a system that already produces enough of it (production ≥ demand)", () => {
    // B sits below its anchor (stock 2 < targetStock 10 × 0.8 = 8 → would classify as a deficit),
    // but it produces 20/tick against demand 5 → it self-supplies. Shipping more in just piles its
    // stock toward the ceiling and decays its own extractors, so it must NOT be a sink.
    const surplus = sys("A", 100, { goodId: "ore", stock: 100, targetStock: 50, demand: 5, production: 0 });
    const producer = sys("B", 0, { goodId: "ore", stock: 2, targetStock: 10, demand: 5, production: 20 });
    expect(matchFactionTransfers([surplus, producer], oneHop).transfers).toHaveLength(0);
  });

  it("still serves a deficit that produces some of the good but cannot self-supply (production < demand)", () => {
    // B produces 3/tick but demands 8 → a genuine net importer; logistics should still fill it.
    const surplus = sys("A", 100, { goodId: "ore", stock: 100, targetStock: 50, demand: 8, production: 0 });
    const importer = sys("B", 0, { goodId: "ore", stock: 0, targetStock: 10, demand: 8, production: 3 });
    const { transfers } = matchFactionTransfers([surplus, importer], oneHop);
    expect(transfers).toHaveLength(1);
    expect(transfers[0]).toMatchObject({ fromSystemId: "A", toSystemId: "B" });
  });

  it("treats a structural producer above its anchor as a surplus, even below the 1.4× margin", () => {
    // A produces 30 > demand 5 → a structural exporter; stock 110 = 1.1× its targetStock 100, BELOW
    // the 1.4× margin (140). The production throttle caps producers at ~1.3× their anchor so they
    // never reach 1.4× — a structural exporter must still donate what it holds above its own anchor
    // (drawable = 110 − 100 = 10), mirroring the deficit-side self-supply gate.
    const producer = sys("A", 100, { goodId: "food", stock: 110, targetStock: 100, demand: 5, production: 30 });
    const deficit = sys("B", 0, { goodId: "food", stock: 2, targetStock: 10, demand: 5, production: 0 });
    const { transfers } = matchFactionTransfers([producer, deficit], oneHop);
    expect(transfers).toHaveLength(1);
    expect(transfers[0]).toMatchObject({ goodId: "food", fromSystemId: "A", toSystemId: "B" });
    // shortfall = 10 − 2 = 8, drawable = 110 − 100 = 10, budget 100 → qty = 8
    expect(transfers[0].quantity).toBe(8);
  });

  it("does NOT treat a non-producer sitting below the 1.4× margin as a surplus (no re-export churn)", () => {
    // A holds stock 110 = 1.1× anchor but produces 0 — it's sitting on imported inventory, not a
    // structural exporter. Only structural producers donate from the 1.0–1.4× band; a non-producer
    // keeps the protective margin so logistics doesn't immediately re-export what was shipped to it.
    const holder = sys("A", 100, { goodId: "food", stock: 110, targetStock: 100, demand: 5, production: 0 });
    const deficit = sys("B", 0, { goodId: "food", stock: 2, targetStock: 10, demand: 5, production: 0 });
    expect(matchFactionTransfers([holder, deficit], oneHop).transfers).toHaveLength(0);
  });

  it("reports a partially funded reachable match", () => {
    const donor = sys("A", 3, { goodId: "food", stock: 100, targetStock: 50, demand: 5 });
    const receiver = sys("B", 0, { goodId: "food", stock: 0, targetStock: 10, demand: 5 });
    const result = matchFactionTransfers([donor, receiver], oneHop);
    expect(result.transfers[0].quantity).toBe(3);
    expect(result.fundingBound).toEqual([{ goodId: "food", fromSystemId: "A", toSystemId: "B" }]);
  });

  it("reports a zero-budget reachable match without emitting a transfer", () => {
    const donor = sys("A", 0, { goodId: "food", stock: 100, targetStock: 50, demand: 5 });
    const receiver = sys("B", 0, { goodId: "food", stock: 0, targetStock: 10, demand: 5 });
    const result = matchFactionTransfers([donor, receiver], oneHop);
    expect(result.transfers).toEqual([]);
    expect(result.fundingBound).toHaveLength(1);
  });

  it("does not mark an ample-budget or drawable-bound transfer", () => {
    const donor = sys("A", 100, { goodId: "food", stock: 54, targetStock: 50, demand: 5, production: 10 });
    const receiver = sys("B", 0, { goodId: "food", stock: 0, targetStock: 10, demand: 5 });
    const result = matchFactionTransfers([donor, receiver], oneHop);
    expect(result.transfers[0].quantity).toBe(4);
    expect(result.fundingBound).toEqual([]);
  });

  it("does not mark unreachable or source-less deficits", () => {
    const donor = sys("A", 0, { goodId: "food", stock: 100, targetStock: 50, demand: 5 });
    const receiver = sys("far", 0, { goodId: "food", stock: 0, targetStock: 10, demand: 5 });
    expect(matchFactionTransfers([donor, receiver], oneHop).fundingBound).toEqual([]);
  });

  it("continues classifying later deficits after the budget is exhausted", () => {
    const donor = sys("A", 2, { goodId: "food", stock: 100, targetStock: 50, demand: 5 });
    const severe = sys("B", 0, { goodId: "food", stock: 0, targetStock: 10, demand: 10 });
    const later = sys("C", 0, { goodId: "food", stock: 0, targetStock: 10, demand: 1 });
    const result = matchFactionTransfers([donor, severe, later], oneHop);
    expect(result.transfers).toHaveLength(1);
    expect(result.fundingBound.map((match) => match.toSystemId)).toEqual(["B", "C"]);
  });
});

// Direct coverage of the donor test shared by the logistics matcher AND the build planner.
// The two-path rule (clears-margin OR structural-producer-above-anchor) and its guards are
// pinned here so a boundary mutation — e.g. the structural-producer `>` softening to `>=`, or a
// dropped zero-anchor guard — fails a test rather than silently regressing directed logistics.
describe("surplusDrawable", () => {
  const margin = DIRECTED_LOGISTICS.SURPLUS_MARGIN; // 1.4

  it("returns 0 for a zero/negative demand anchor (no days-of-supply target), even for a producer", () => {
    expect(surplusDrawable(50, 0, 5, 30)).toBe(0);
    expect(surplusDrawable(50, -10, 5, 30)).toBe(0);
  });

  it("returns 0 at or below the anchor (never donates a system below its own days-of-supply)", () => {
    expect(surplusDrawable(100, 100, 5, 30)).toBe(0); // exactly at anchor → aboveAnchor 0
    expect(surplusDrawable(90, 100, 5, 30)).toBe(0); // below anchor, even a structural producer
  });

  it("path (a): any holder clearing the surplus margin donates stock above its anchor", () => {
    // stock 150 ≥ 100 × 1.4 = 140 → clears margin; non-producer still donates 150 − 100 = 50.
    expect(surplusDrawable(100 * margin + 10, 100, 5, 0)).toBe(100 * margin + 10 - 100);
  });

  it("path (b): a structural producer above its anchor donates even below the 1.4× margin", () => {
    // stock 110 = 1.1× anchor (below 140), production 30 > demand 5 → drawable 110 − 100 = 10.
    expect(surplusDrawable(110, 100, 5, 30)).toBe(10);
  });

  it("excludes a non-producer sitting in the 1.0–1.4× band (no re-export churn)", () => {
    // stock 110 in-band, production 0 ≤ demand 5, doesn't clear the margin → not drawable.
    expect(surplusDrawable(110, 100, 5, 0)).toBe(0);
  });

  it("excludes the production == demand boundary in-band (a balanced self-supplier is not a donor)", () => {
    // Pins the strict `production > demand`: equal production must NOT qualify as path (b).
    expect(surplusDrawable(110, 100, 5, 5)).toBe(0);
    // A hair above demand DOES qualify — confirms the boundary sits exactly at equality.
    expect(surplusDrawable(110, 100, 5, 5.01)).toBe(10);
  });
});
