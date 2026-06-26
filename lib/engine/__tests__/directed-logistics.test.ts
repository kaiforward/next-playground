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
  good: { goodId: string; stock: number; minStock: number; maxStock: number; demand: number },
): SystemLogisticsState {
  return { systemId, factionId: "f1", generation, goods: [good] };
}

// Unit cost = hops; 1 hop between any two systems, unreachable for "far".
const oneHop: RouteCost = (_from, to) => (to === "far" ? null : 1);

describe("matchFactionTransfers", () => {
  it("moves drawable surplus to a below-floor deficit", () => {
    const surplus = sys("A", 100, { goodId: "food", stock: 100, minStock: 10, maxStock: 100, demand: 5 });
    const deficit = sys("B", 0, { goodId: "food", stock: 2, minStock: 10, maxStock: 100, demand: 5 });
    const transfers = matchFactionTransfers([surplus, deficit], oneHop);
    expect(transfers).toHaveLength(1);
    expect(transfers[0]).toMatchObject({ goodId: "food", fromSystemId: "A", toSystemId: "B" });
    // shortfall = minStock - stock = 8; drawable = stock - minStock = 90; budget = 100/1 → 8 wins
    expect(transfers[0].quantity).toBe(8);
    expect(transfers[0].cost).toBe(8); // quantity × 1 hop
  });

  it("never draws a source below its own floor", () => {
    const surplus = sys("A", 100, { goodId: "food", stock: 12, minStock: 10, maxStock: 12, demand: 5 });
    const deficit = sys("B", 0, { goodId: "food", stock: 0, minStock: 10, maxStock: 100, demand: 5 });
    const transfers = matchFactionTransfers([surplus, deficit], oneHop);
    expect(transfers[0].quantity).toBe(2); // drawable = 12 - 10
  });

  it("is bounded by the faction budget (under-serves, leaving residual)", () => {
    const surplus = sys("A", 3, { goodId: "food", stock: 100, minStock: 10, maxStock: 100, demand: 5 });
    const deficit = sys("B", 0, { goodId: "food", stock: 0, minStock: 10, maxStock: 100, demand: 5 });
    // budget = 3 (only A generates), cost 1/unit → at most 3 moved despite a shortfall of 10
    const transfers = matchFactionTransfers([surplus, deficit], oneHop);
    expect(transfers[0].quantity).toBe(3);
  });

  it("ranks the most severe deficit first when budget is scarce", () => {
    const surplus = sys("A", 5, { goodId: "food", stock: 100, minStock: 10, maxStock: 100, demand: 1 });
    // B mild (demand 1), C severe (demand 10) — C should be served first.
    const mild = sys("B", 0, { goodId: "food", stock: 5, minStock: 10, maxStock: 100, demand: 1 });
    const severe = sys("C", 0, { goodId: "food", stock: 5, minStock: 10, maxStock: 100, demand: 10 });
    const transfers = matchFactionTransfers([surplus, mild, severe], oneHop);
    expect(transfers[0].toSystemId).toBe("C");
  });

  it("skips unreachable deficits (route cost null)", () => {
    const surplus = sys("A", 100, { goodId: "food", stock: 100, minStock: 10, maxStock: 100, demand: 5 });
    const deficit = sys("far", 0, { goodId: "food", stock: 0, minStock: 10, maxStock: 100, demand: 5 });
    expect(matchFactionTransfers([surplus, deficit], oneHop)).toHaveLength(0);
  });

  it("ignores goods that are neither surplus nor deficit", () => {
    const a = sys("A", 100, { goodId: "food", stock: 50, minStock: 10, maxStock: 100, demand: 5 });
    const b = sys("B", 0, { goodId: "food", stock: 50, minStock: 10, maxStock: 100, demand: 5 });
    expect(matchFactionTransfers([a, b], oneHop)).toHaveLength(0);
  });

  it("draws one source across two deficits without exceeding its drawable", () => {
    // A: near-ceiling surplus, drawable = 20 - 10 = 10. Only A generates → budget = 100.
    const surplus = sys("A", 100, { goodId: "food", stock: 20, minStock: 10, maxStock: 20, demand: 0 });
    // C more severe (demand 10), B less severe (demand 1); each shortfall = 6.
    const severe = sys("C", 0, { goodId: "food", stock: 4, minStock: 10, maxStock: 100, demand: 10 });
    const mild = sys("B", 0, { goodId: "food", stock: 4, minStock: 10, maxStock: 100, demand: 1 });
    const transfers = matchFactionTransfers([surplus, severe, mild], oneHop);
    // C served first (severity 60 > 6): qty = min(shortfall 6, drawable 10, budget 100) = 6.
    // B served from A's residual drawable (10 - 6 = 4): qty = min(shortfall 6, drawable 4, budget 94) = 4.
    // Proves the source is not over-drawn below its floor across iterations.
    expect(transfers).toHaveLength(2);
    expect(transfers[0]).toMatchObject({ fromSystemId: "A", toSystemId: "C", quantity: 6 });
    expect(transfers[1]).toMatchObject({ fromSystemId: "A", toSystemId: "B", quantity: 4 });
  });
});
