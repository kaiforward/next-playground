import { describe, it, expect } from "vitest";
import {
  systemLogisticsGeneration,
  matchFactionTransfers,
  type SystemLogisticsState,
  type RouteCost,
} from "@/lib/engine/directed-logistics";
import { DIRECTED_LOGISTICS } from "@/lib/constants/directed-logistics";

describe("systemLogisticsGeneration", () => {
  it("scales linearly with population", () => {
    expect(systemLogisticsGeneration(100)).toBeCloseTo(100 * DIRECTED_LOGISTICS.GENERATION_PER_POP);
  });
  it("never negative (clamps negative population to 0)", () => {
    expect(systemLogisticsGeneration(-5)).toBe(0);
  });
});

// Helper: a system with one good's market state.
function sys(
  systemId: string,
  generation: number,
  good: { goodId: string; stock: number; minStock: number; targetStock: number; demand: number },
): SystemLogisticsState {
  return { systemId, factionId: "f1", generation, goods: [good] };
}

// Unit cost = hops; 1 hop between any two systems, unreachable for "far".
const oneHop: RouteCost = (_from, to) => (to === "far" ? null : 1);

describe("matchFactionTransfers", () => {
  it("moves drawable surplus to a below-floor deficit", () => {
    // A: stock 100 ≥ targetStock 50 × 1.4 = 70 ✓ surplus; drawable = 100 − 10 = 90
    // B: stock 2 < minStock 10 ✓ deficit; shortfall = 8
    // qty = min(8, 90, budget 100) = 8; cost = 8
    const surplus = sys("A", 100, { goodId: "food", stock: 100, minStock: 10, targetStock: 50, demand: 5 });
    const deficit = sys("B", 0, { goodId: "food", stock: 2, minStock: 10, targetStock: 10, demand: 5 });
    const transfers = matchFactionTransfers([surplus, deficit], oneHop);
    expect(transfers).toHaveLength(1);
    expect(transfers[0]).toMatchObject({ goodId: "food", fromSystemId: "A", toSystemId: "B" });
    expect(transfers[0].quantity).toBe(8);
    expect(transfers[0].cost).toBe(8); // quantity × 1 hop
  });

  it("never draws a source below its own floor", () => {
    // A: stock 12 ≥ targetStock 8 × 1.4 = 11.2 ✓ surplus; drawable = 12 − 10 = 2
    // B: stock 0 < minStock 10 ✓ deficit
    const surplus = sys("A", 100, { goodId: "food", stock: 12, minStock: 10, targetStock: 8, demand: 5 });
    const deficit = sys("B", 0, { goodId: "food", stock: 0, minStock: 10, targetStock: 10, demand: 5 });
    const transfers = matchFactionTransfers([surplus, deficit], oneHop);
    expect(transfers[0].quantity).toBe(2); // drawable = 12 - 10
  });

  it("is bounded by the faction budget (under-serves, leaving residual)", () => {
    // A: stock 100 ≥ targetStock 50 × 1.4 = 70 ✓ surplus; budget = 3 → at most 3 moved
    const surplus = sys("A", 3, { goodId: "food", stock: 100, minStock: 10, targetStock: 50, demand: 5 });
    const deficit = sys("B", 0, { goodId: "food", stock: 0, minStock: 10, targetStock: 10, demand: 5 });
    // budget = 3 (only A generates), cost 1/unit → at most 3 moved despite a shortfall of 10
    const transfers = matchFactionTransfers([surplus, deficit], oneHop);
    expect(transfers[0].quantity).toBe(3);
  });

  it("ranks the most severe deficit first when budget is scarce", () => {
    // A: stock 100 ≥ targetStock 50 × 1.4 = 70 ✓ surplus
    // B mild (demand 1), C severe (demand 10) — C should be served first.
    const surplus = sys("A", 5, { goodId: "food", stock: 100, minStock: 10, targetStock: 50, demand: 1 });
    const mild = sys("B", 0, { goodId: "food", stock: 5, minStock: 10, targetStock: 10, demand: 1 });
    const severe = sys("C", 0, { goodId: "food", stock: 5, minStock: 10, targetStock: 10, demand: 10 });
    const transfers = matchFactionTransfers([surplus, mild, severe], oneHop);
    expect(transfers[0].toSystemId).toBe("C");
  });

  it("skips unreachable deficits (route cost null)", () => {
    const surplus = sys("A", 100, { goodId: "food", stock: 100, minStock: 10, targetStock: 50, demand: 5 });
    const deficit = sys("far", 0, { goodId: "food", stock: 0, minStock: 10, targetStock: 10, demand: 5 });
    expect(matchFactionTransfers([surplus, deficit], oneHop)).toHaveLength(0);
  });

  it("ignores goods that are neither surplus nor deficit", () => {
    // a: stock 50 < targetStock 50 × 1.4 = 70 → NOT surplus; stock 50 ≥ minStock 10 → NOT deficit
    // b: same → NOT surplus, NOT deficit
    const a = sys("A", 100, { goodId: "food", stock: 50, minStock: 10, targetStock: 50, demand: 5 });
    const b = sys("B", 0, { goodId: "food", stock: 50, minStock: 10, targetStock: 50, demand: 5 });
    expect(matchFactionTransfers([a, b], oneHop)).toHaveLength(0);
  });

  it("draws one source across two deficits without exceeding its drawable", () => {
    // A: stock 20 ≥ targetStock 10 × 1.4 = 14 ✓ surplus; drawable = 20 − 10 = 10. budget = 100.
    const surplus = sys("A", 100, { goodId: "food", stock: 20, minStock: 10, targetStock: 10, demand: 0 });
    // C more severe (demand 10), B less severe (demand 1); each shortfall = 6.
    const severe = sys("C", 0, { goodId: "food", stock: 4, minStock: 10, targetStock: 10, demand: 10 });
    const mild = sys("B", 0, { goodId: "food", stock: 4, minStock: 10, targetStock: 10, demand: 1 });
    const transfers = matchFactionTransfers([surplus, severe, mild], oneHop);
    // C served first (severity 60 > 6): qty = min(shortfall 6, drawable 10, budget 100) = 6.
    // B served from A's residual drawable (10 - 6 = 4): qty = min(shortfall 6, drawable 4, budget 94) = 4.
    // Proves the source is not over-drawn below its floor across iterations.
    expect(transfers).toHaveLength(2);
    expect(transfers[0]).toMatchObject({ fromSystemId: "A", toSystemId: "C", quantity: 6 });
    expect(transfers[1]).toMatchObject({ fromSystemId: "A", toSystemId: "B", quantity: 4 });
  });

  it("treats a market above its anchor as a surplus even when far from any storage ceiling", () => {
    // stock 80 = 1.6× its targetStock of 50 → surplus under the anchor rule, though nowhere near a
    // storage ceiling. The near-ceiling rule (stock ≥ maxStock×0.9) missed exactly this case
    // (simulator diagnosis 2026-06-26).
    const surplus = sys("A", 100, { goodId: "food", stock: 80, minStock: 10, targetStock: 50, demand: 5 });
    const deficit = sys("B", 0, { goodId: "food", stock: 0, minStock: 10, targetStock: 10, demand: 5 });
    const transfers = matchFactionTransfers([surplus, deficit], oneHop);
    expect(transfers).toHaveLength(1);
    expect(transfers[0]).toMatchObject({ fromSystemId: "A", toSystemId: "B" });
    // shortfall = 10, drawable = 80−10 = 70, budget = 100 → qty = 10
    expect(transfers[0].quantity).toBe(10);
  });
});
