import { describe, it, expect } from "vitest";
import {
  systemLogisticsGeneration,
  matchFactionTransfers,
  classifyMarketState,
  surplusDrawable,
  type SystemLogisticsState,
  type RouteCost,
  type ReachableSystemIds,
} from "@/lib/engine/directed-logistics";
import { DIRECTED_LOGISTICS } from "@/lib/constants/directed-logistics";
import { ECONOMY_CONSTANTS, TARGET_COVER } from "@/lib/constants/economy";

describe("classifyMarketState", () => {
  it("classifies below the deficit fraction as deficit with shortfall to target", () => {
    // logisticsTarget 10, DEFICIT_FRACTION 0.8 → threshold 8; stock 2 < 8.
    const c = classifyMarketState(2, 10);
    expect(c.kind).toBe("deficit");
    expect(c.shortfall).toBe(8);
    expect(c.drawable).toBe(0);
  });

  it("classifies at/above the surplus margin as surplus with drawable above target", () => {
    // logisticsTarget 50, SURPLUS_MARGIN 1.4 → threshold 70; stock 100 ≥ 70.
    const c = classifyMarketState(100, 50);
    expect(c.kind).toBe("surplus");
    expect(c.drawable).toBe(50);
    expect(c.shortfall).toBe(0);
  });

  it("classifies the dead-band between thresholds as balanced", () => {
    // logisticsTarget 10 → deficit < 8, surplus ≥ 14; stock 10 is between.
    const c = classifyMarketState(10, 10);
    expect(c.kind).toBe("balanced");
    expect(c.shortfall).toBe(0);
    expect(c.drawable).toBe(0);
  });

  it("never reports a negative shortfall or drawable", () => {
    expect(classifyMarketState(0, 0).kind).toBe("balanced");
    expect(classifyMarketState(7.9, 10).shortfall).toBeCloseTo(2.1);
  });

  it("classifies a zero-anchor good (logisticsTarget 0, positive stock) as balanced, not surplus", () => {
    const c = classifyMarketState(50, 0);
    expect(c.kind).toBe("balanced");
    expect(c.drawable).toBe(0);
  });

  it("treats stock exactly at the deficit threshold as balanced, not a deficit", () => {
    // threshold = target(10) × DEFICIT_FRACTION(0.8) = 8 exactly — the boundary itself must sit in
    // the dead-band, not the deficit side of the `<` comparison.
    const c = classifyMarketState(8, 10);
    expect(c.kind).toBe("balanced");
    expect(c.shortfall).toBe(0);
  });

  it("treats stock exactly at the surplus margin as a surplus", () => {
    // threshold = target(50) × SURPLUS_MARGIN(1.4) = 70 exactly — the `>=` comparison's own boundary.
    const c = classifyMarketState(70, 50);
    expect(c.kind).toBe("surplus");
    expect(c.drawable).toBe(20);
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
  good: {
    goodId: string; stock: number; logisticsTarget: number; demand: number; civilianDemand?: number;
    /** What the ordinary-donor branch stops at. Defaults to the same demand × anchorMult the fixture
     *  states through its warehousing target, which is how the tick path derives it — the two covers
     *  are equal today, so the default moves with either constant instead of pinning a figure. */
    donorReserve?: number;
    production?: number; capacityProduction?: number; productionSuppressed?: boolean;
    /** Urgency weight. Defaults to `demand` — nothing braked, no event running — which is what
     *  every fixture predating the two-figure split states by construction. */
    drawDemand?: number;
  },
): SystemLogisticsState {
  const production = good.production ?? 0;
  return {
    systemId, factionId: "f1", generation,
    goods: [{
      ...good,
      drawDemand: good.drawDemand ?? good.demand,
      donorReserve: good.donorReserve
        ?? good.logisticsTarget
          * (DIRECTED_LOGISTICS.DONOR_RESERVE_COVER / DIRECTED_LOGISTICS.WAREHOUSE_COVER),
      production,
      capacityProduction: good.capacityProduction ?? production,
      // The matcher never reads it (only the build planner's fed-gate does); these fixtures are
      // pure consumers, so all of their demand is civilian.
      civilianDemand: good.civilianDemand ?? good.demand,
    }],
  };
}

// Unit cost = hops; 1 hop between any two systems, unreachable for "far".
const oneHop: RouteCost = (_from, to) => (to === "far" ? null : 1);

describe("matchFactionTransfers", () => {
  it("moves drawable surplus to a below-anchor deficit", () => {
    // A: stock 100 ≥ logisticsTarget 50 × 1.4 = 70 ✓ surplus; drawable = 100 − 50 = 50
    // B: stock 2 < logisticsTarget 10 × 0.8 = 8 ✓ deficit; shortfall = 10 − 2 = 8
    // qty = min(8, 50, budget 100) = 8; cost = 8
    const surplus = sys("A", 100, { goodId: "food", stock: 100, logisticsTarget: 50, demand: 5 });
    const deficit = sys("B", 0, { goodId: "food", stock: 2, logisticsTarget: 10, demand: 5 });
    const { transfers } = matchFactionTransfers([surplus, deficit], oneHop);
    expect(transfers).toHaveLength(1);
    expect(transfers[0]).toMatchObject({ goodId: "food", fromSystemId: "A", toSystemId: "B" });
    expect(transfers[0].quantity).toBe(8);
    expect(transfers[0].cost).toBe(8); // quantity × 1 hop
  });

  it("never draws a source below its own target", () => {
    // A: stock 12 ≥ logisticsTarget 8 × 1.4 = 11.2 ✓ surplus; drawable = 12 − 8 = 4
    // B: stock 0 < logisticsTarget 10 × 0.8 = 8 ✓ deficit; shortfall = 10 − 0 = 10
    // qty = min(10, 4, budget 100) = 4 — donor draws down to its own target (8), not below it
    const surplus = sys("A", 100, { goodId: "food", stock: 12, logisticsTarget: 8, demand: 5 });
    const deficit = sys("B", 0, { goodId: "food", stock: 0, logisticsTarget: 10, demand: 5 });
    const { transfers } = matchFactionTransfers([surplus, deficit], oneHop);
    expect(transfers[0].quantity).toBe(4); // drawable = 12 - 8 (target)
  });

  it("is bounded by the faction budget (under-serves, leaving residual)", () => {
    // A: stock 100 ≥ logisticsTarget 50 × 1.4 = 70 ✓ surplus; budget = 3 → at most 3 moved
    const surplus = sys("A", 3, { goodId: "food", stock: 100, logisticsTarget: 50, demand: 5 });
    const deficit = sys("B", 0, { goodId: "food", stock: 0, logisticsTarget: 10, demand: 5 });
    // budget = 3 (only A generates), cost 1/unit → at most 3 moved despite a shortfall of 10
    const { transfers } = matchFactionTransfers([surplus, deficit], oneHop);
    expect(transfers[0].quantity).toBe(3);
  });

  it("ranks the most severe deficit first when budget is scarce", () => {
    // A: stock 100 ≥ logisticsTarget 50 × 1.4 = 70 ✓ surplus
    // B mild (demand 1), C severe (demand 10) — C should be served first.
    const surplus = sys("A", 5, { goodId: "food", stock: 100, logisticsTarget: 50, demand: 1 });
    const mild = sys("B", 0, { goodId: "food", stock: 5, logisticsTarget: 10, demand: 1 });
    const severe = sys("C", 0, { goodId: "food", stock: 5, logisticsTarget: 10, demand: 10 });
    const { transfers } = matchFactionTransfers([surplus, mild, severe], oneHop);
    expect(transfers[0].toSystemId).toBe("C");
  });

  it("does not haul to a market whose demand only clears the MIN_DEMAND pricing floor", () => {
    // C is a small colony: real demand 0.01/cycle, so its persisted demandRate is pinned at the
    // MIN_DEMAND guard and its PRICE anchor reads 2 — 200 cycles of what it actually uses. Its
    // warehousing target is the honest 40 × 0.01 = 0.4, which its stock of 1 already clears.
    // B is a real consumer with the same good and a genuine shortfall.
    const donor = sys("A", 100, { goodId: "food", stock: 100, logisticsTarget: 50, demand: 5 });
    const real = sys("B", 0, { goodId: "food", stock: 0, logisticsTarget: 10, demand: 5 });
    const floored = sys("C", 0, {
      goodId: "food", stock: 1, logisticsTarget: 0.4, demand: 0.01,
    });

    const { transfers } = matchFactionTransfers([donor, real, floored], oneHop);
    expect(transfers.map((t) => t.toSystemId)).toEqual(["B"]);

    // Discrimination check: the ONLY thing keeping C out is the separated denominator. Point its
    // warehousing target back at the price anchor — what the matcher read before the split — and C
    // becomes a deficit again. If this half ever stops producing two transfers, the case above has
    // stopped proving anything.
    const asBefore = sys("C", 0, {
      goodId: "food", stock: 1, logisticsTarget: 2, demand: 0.01,
    });
    const before = matchFactionTransfers([donor, real, asBefore], oneHop);
    expect(before.transfers.map((t) => t.toSystemId)).toEqual(["B", "C"]);
  });

  it("still hauls to a small market whose real demand clears the floor", () => {
    // The mirror of the case above — the change must not simply stop serving small worlds. Real
    // demand 0.5/cycle gives a warehousing target of 20, and a stock of 1 is a genuine shortfall.
    const donor = sys("A", 100, { goodId: "food", stock: 100, logisticsTarget: 50, demand: 5 });
    const small = sys("C", 0, {
      goodId: "food", stock: 1, logisticsTarget: 20, demand: 0.5,
    });
    const { transfers } = matchFactionTransfers([donor, small], oneHop);
    expect(transfers.map((t) => t.toSystemId)).toEqual(["C"]);
    expect(transfers[0].quantity).toBe(19);
  });

  // ── Both ends of a match are denominated in real demand: the deficit side fills to the warehousing
  // target, an ordinary donor stops at its own reserve. These cases pin that shape at a floored
  // market, where real demand sits under MIN_DEMAND and the demand-denominated figures diverge from
  // the price anchor — the ordinary-donor cases fail if the reserve is repointed back at the anchor.
  // Every other fixture in this file describes markets where the figures coincide.

  it("keeps a pure exporter shipping despite a zero warehousing target", () => {
    // A raw-material exporter consumes none of what it digs: real demand 0, so its warehousing
    // target is legitimately 0. A zero demand-derived figure must never read as "no market here" —
    // that would stop raw-material trade dead across the galaxy. The exporter branch runs on
    // production alone.
    const exporter = sys("A", 100, {
      goodId: "ore", stock: 500, logisticsTarget: 0, demand: 0, production: 30,
    });
    const consumer = sys("B", 0, { goodId: "ore", stock: 0, logisticsTarget: 10, demand: 5 });

    const { transfers } = matchFactionTransfers([exporter, consumer], oneHop);
    expect(transfers).toHaveLength(1);
    expect(transfers[0]).toMatchObject({ fromSystemId: "A", toSystemId: "B" });
    // Drawable is the whole stock (exporter reserve = 10 × demand 0), so the recipient's
    // shortfall binds: 10 − 0.
    expect(transfers[0].quantity).toBe(10);
  });

  it("sizes an ordinary donor's drawable off its own demand reserve, not the price anchor", () => {
    // The non-exporter branch at the same floored market, where the two figures diverge. A consumes
    // 0.01/cycle, so it keeps DONOR_RESERVE_COVER cycles of that — a reserve of 0.4 — clears the 1.4×
    // margin on it (0.56) and donates 2.9 − 0.4 = 2.5. Measured against the floored anchor of 2 it
    // would donate 0.9, holding back stock on behalf of a divide-by-zero guard on pricing rather than
    // anyone who lives there.
    const donor = sys("A", 100, {
      goodId: "food", stock: 2.9, logisticsTarget: 0.4, donorReserve: 0.4,
      demand: 0.01, production: 0,
    });
    const consumer = sys("B", 0, { goodId: "food", stock: 0, logisticsTarget: 10, demand: 5 });

    const { transfers } = matchFactionTransfers([donor, consumer], oneHop);
    expect(transfers).toHaveLength(1);
    expect(transfers[0].quantity).toBeCloseTo(2.5, 10);
  });

  it("draws a below-anchor floored market that clears the margin on its own reserve", () => {
    // C holds 1.5 — below the floored price anchor (2 at MIN_DEMAND), so an anchor-denominated rule
    // would see no source here at all; against its own reserve of 0.4 it is well clear of the 0.56
    // margin and donates 1.1. Small markets hold real stock the galaxy can reach.
    const floored = sys("C", 100, {
      goodId: "food", stock: 1.5, logisticsTarget: 0.4, donorReserve: 0.4,
      demand: 0.01, production: 0,
    });
    const consumer = sys("B", 0, { goodId: "food", stock: 0, logisticsTarget: 10, demand: 5 });

    const { transfers } = matchFactionTransfers([floored, consumer], oneHop);
    expect(transfers).toHaveLength(1);
    expect(transfers[0]).toMatchObject({ fromSystemId: "C", toSystemId: "B" });
    expect(transfers[0].quantity).toBeCloseTo(1.1, 10);
  });

  it("never draws an ordinary donor below its reserve, which rides the market's anchor multiplier", () => {
    // An anchor_shift doubling A's anchors doubles the floor it stops at, exactly as it doubles the
    // target the deficit side fills to — the two move together by construction. B wants far more than
    // A can spare, so what binds the haul is A's own reserve: it ends holding exactly that.
    const demand = 2;
    const anchorMult = 2;
    const reserve = DIRECTED_LOGISTICS.DONOR_RESERVE_COVER * demand * anchorMult;
    const donor = sys("A", 1e6, {
      goodId: "food", stock: 300, demand, production: 0, donorReserve: reserve,
      logisticsTarget: DIRECTED_LOGISTICS.WAREHOUSE_COVER * demand * anchorMult,
    });
    const consumer = sys("B", 0, { goodId: "food", stock: 0, logisticsTarget: 1000, demand: 50 });

    const { transfers } = matchFactionTransfers([donor, consumer], oneHop);
    expect(transfers).toHaveLength(1);
    expect(transfers[0].quantity).toBeCloseTo(300 - reserve, 10);
    expect(300 - transfers[0].quantity).toBeCloseTo(reserve, 10);
  });

  it("skips unreachable deficits (route cost null)", () => {
    const surplus = sys("A", 100, { goodId: "food", stock: 100, logisticsTarget: 50, demand: 5 });
    const deficit = sys("far", 0, { goodId: "food", stock: 0, logisticsTarget: 10, demand: 5 });
    expect(matchFactionTransfers([surplus, deficit], oneHop).transfers).toHaveLength(0);
  });

  it("ignores goods that are neither surplus nor deficit", () => {
    // a: stock 50 < logisticsTarget 50 × 1.4 = 70 → NOT surplus; stock 50 ≥ logisticsTarget 50 × 0.8 = 40 → NOT deficit
    // b: same → NOT surplus, NOT deficit
    const a = sys("A", 100, { goodId: "food", stock: 50, logisticsTarget: 50, demand: 5 });
    const b = sys("B", 0, { goodId: "food", stock: 50, logisticsTarget: 50, demand: 5 });
    expect(matchFactionTransfers([a, b], oneHop).transfers).toHaveLength(0);
  });

  it("draws one source across two deficits without exceeding its drawable", () => {
    // A: stock 20 ≥ logisticsTarget 10 × 1.4 = 14 ✓ surplus; drawable = 20 − 10 = 10. budget = 100.
    const surplus = sys("A", 100, { goodId: "food", stock: 20, logisticsTarget: 10, demand: 0 });
    // C more severe (demand 10), B less severe (demand 1); each: stock 4 < 10 × 0.8 = 8 ✓ deficit, shortfall = 6.
    const severe = sys("C", 0, { goodId: "food", stock: 4, logisticsTarget: 10, demand: 10 });
    const mild = sys("B", 0, { goodId: "food", stock: 4, logisticsTarget: 10, demand: 1 });
    const { transfers } = matchFactionTransfers([surplus, severe, mild], oneHop);
    // C served first (severity 60 > 6): qty = min(shortfall 6, drawable 10, budget 100) = 6.
    // B served from A's residual drawable (10 - 6 = 4): qty = min(shortfall 6, drawable 4, budget 94) = 4.
    // Proves the source is not over-drawn below its own target across iterations.
    expect(transfers).toHaveLength(2);
    expect(transfers[0]).toMatchObject({ fromSystemId: "A", toSystemId: "C", quantity: 6 });
    expect(transfers[1]).toMatchObject({ fromSystemId: "A", toSystemId: "B", quantity: 4 });
  });

  it("treats a market above its anchor as a surplus even when far from any storage ceiling", () => {
    // stock 80 = 1.6× its logisticsTarget of 50 → surplus under the anchor rule, though nowhere near a
    // storage ceiling. The near-ceiling rule (stock ≥ maxStock×0.9) missed exactly this case
    // (simulator diagnosis 2026-06-26).
    const surplus = sys("A", 100, { goodId: "food", stock: 80, logisticsTarget: 50, demand: 5 });
    const deficit = sys("B", 0, { goodId: "food", stock: 0, logisticsTarget: 10, demand: 5 });
    const { transfers } = matchFactionTransfers([surplus, deficit], oneHop);
    expect(transfers).toHaveLength(1);
    expect(transfers[0]).toMatchObject({ fromSystemId: "A", toSystemId: "B" });
    // shortfall = 10, drawable = 80−50 = 30, budget = 100 → qty = 10
    expect(transfers[0].quantity).toBe(10);
  });

  it("never ships a good into a system that already produces enough of it (production ≥ demand)", () => {
    // B sits below its anchor (stock 2 < logisticsTarget 10 × 0.8 = 8 → would classify as a deficit),
    // but it produces 20/tick against demand 5 → it self-supplies. Shipping more in just piles its
    // stock toward the ceiling and decays its own extractors, so it must NOT be a sink.
    const surplus = sys("A", 100, { goodId: "ore", stock: 100, logisticsTarget: 50, demand: 5, production: 0 });
    const producer = sys("B", 0, { goodId: "ore", stock: 2, logisticsTarget: 10, demand: 5, production: 20 });
    expect(matchFactionTransfers([surplus, producer], oneHop).transfers).toHaveLength(0);
  });

  it("still serves a deficit that produces some of the good but cannot self-supply (production < demand)", () => {
    // B produces 3/tick but demands 8 → a genuine net importer; logistics should still fill it.
    const surplus = sys("A", 100, { goodId: "ore", stock: 100, logisticsTarget: 50, demand: 8, production: 0 });
    const importer = sys("B", 0, { goodId: "ore", stock: 0, logisticsTarget: 10, demand: 8, production: 3 });
    const { transfers } = matchFactionTransfers([surplus, importer], oneHop);
    expect(transfers).toHaveLength(1);
    expect(transfers[0]).toMatchObject({ fromSystemId: "A", toSystemId: "B" });
  });

  it("treats a structural producer above its anchor as a surplus, even below the 1.4× margin", () => {
    // A produces 30 > demand 5 → a structural exporter; stock 110 = 1.1× its logisticsTarget 100, BELOW
    // the 1.4× margin (140). The production throttle caps producers at ~1.3× their anchor so they
    // never reach 1.4× — a structural exporter must still donate what it holds above its own anchor
    // (drawable = 110 − 100 = 10), mirroring the deficit-side self-supply gate.
    const producer = sys("A", 100, { goodId: "food", stock: 110, logisticsTarget: 100, demand: 5, production: 30 });
    const deficit = sys("B", 0, { goodId: "food", stock: 2, logisticsTarget: 10, demand: 5, production: 0 });
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
    const holder = sys("A", 100, { goodId: "food", stock: 110, logisticsTarget: 100, demand: 5, production: 0 });
    const deficit = sys("B", 0, { goodId: "food", stock: 2, logisticsTarget: 10, demand: 5, production: 0 });
    expect(matchFactionTransfers([holder, deficit], oneHop).transfers).toHaveLength(0);
  });

  it("reports a partially funded reachable match", () => {
    const donor = sys("A", 3, { goodId: "food", stock: 100, logisticsTarget: 50, demand: 5 });
    const receiver = sys("B", 0, { goodId: "food", stock: 0, logisticsTarget: 10, demand: 5 });
    const result = matchFactionTransfers([donor, receiver], oneHop);
    expect(result.transfers[0].quantity).toBe(3);
    expect(result.fundingBound).toEqual([{ goodId: "food", fromSystemId: "A", toSystemId: "B" }]);
  });

  it("reports a zero-budget reachable match without emitting a transfer", () => {
    const donor = sys("A", 0, { goodId: "food", stock: 100, logisticsTarget: 50, demand: 5 });
    const receiver = sys("B", 0, { goodId: "food", stock: 0, logisticsTarget: 10, demand: 5 });
    const result = matchFactionTransfers([donor, receiver], oneHop);
    expect(result.transfers).toEqual([]);
    expect(result.fundingBound).toHaveLength(1);
  });

  it("does not mark a deficit left only trivially short by a budget-stopped final draw", () => {
    // D1 affordably delivers 95 of the shortfall of 100; the budget then stops D2's draw with a
    // residual of 5 — 5% of the original shortfall, under FUNDING_BOUND_RESIDUAL_FRACTION (10%).
    // The flag means "this market's shortfall persists because of money" — it suppresses the
    // planner's capacity proposals and exempts producers from idle decay — so a 95%-served market
    // must not set it. A naive per-draw recording (any unaffordable draw ⇒ flag) fails here.
    const d1 = sys("D1", 95, { goodId: "food", stock: 105, logisticsTarget: 10, demand: 5 });
    const d2 = sys("D2", 0, { goodId: "food", stock: 24, logisticsTarget: 10, demand: 5 });
    const deficit = sys("B", 0, { goodId: "food", stock: 0, logisticsTarget: 100, demand: 5 });

    const result = matchFactionTransfers([d1, d2, deficit], oneHop);
    expect(result.transfers).toHaveLength(1);
    expect(result.transfers[0]).toMatchObject({ fromSystemId: "D1", quantity: 95 });
    expect(result.fundingBound).toEqual([]);
  });

  it("marks a deficit the budget left materially short, naming the stopped donor", () => {
    // Same shape at budget 50: D1's draw itself is budget-stopped at 50 of the wanted 95, leaving
    // a residual of 50% — far over the 10% materiality line, so the flag is set and carries the
    // donor whose draw the budget stopped.
    const d1 = sys("D1", 50, { goodId: "food", stock: 105, logisticsTarget: 10, demand: 5 });
    const d2 = sys("D2", 0, { goodId: "food", stock: 24, logisticsTarget: 10, demand: 5 });
    const deficit = sys("B", 0, { goodId: "food", stock: 0, logisticsTarget: 100, demand: 5 });

    const result = matchFactionTransfers([d1, d2, deficit], oneHop);
    expect(result.transfers).toHaveLength(1);
    expect(result.transfers[0]).toMatchObject({ fromSystemId: "D1", quantity: 50 });
    expect(result.fundingBound).toEqual([
      { goodId: "food", fromSystemId: "D1", toSystemId: "B" },
    ]);
  });

  it("names the donor the budget stopped, not the cheaper donors that already served", () => {
    // D1's whole drawable of 30 ships affordably (budget 60, cost 30); the budget then stops D2
    // at 30 of the wanted 70, leaving a 40% residual. The row must carry D2 — the stopped donor —
    // because the processor sets the funding-bound flag on the named donor's market (idle-decay
    // exemption + planner suppression), and D1's market earned no such flag.
    const d1 = sys("D1", 60, { goodId: "food", stock: 40, logisticsTarget: 10, demand: 5 });
    const d2 = sys("D2", 0, { goodId: "food", stock: 80, logisticsTarget: 10, demand: 5 });
    const deficit = sys("B", 0, { goodId: "food", stock: 0, logisticsTarget: 100, demand: 5 });

    const result = matchFactionTransfers([d1, d2, deficit], oneHop);
    expect(result.transfers).toHaveLength(2);
    expect(result.transfers[0]).toMatchObject({ fromSystemId: "D1", quantity: 30 });
    expect(result.transfers[1]).toMatchObject({ fromSystemId: "D2", quantity: 30 });
    expect(result.fundingBound).toEqual([
      { goodId: "food", fromSystemId: "D2", toSystemId: "B" },
    ]);
  });

  it("does not mark an ample-budget or drawable-bound transfer", () => {
    const donor = sys("A", 100, { goodId: "food", stock: 14, logisticsTarget: 10, demand: 5, production: 0 });
    const receiver = sys("B", 0, { goodId: "food", stock: 0, logisticsTarget: 10, demand: 5 });
    const result = matchFactionTransfers([donor, receiver], oneHop);
    expect(result.transfers[0].quantity).toBe(4);
    expect(result.fundingBound).toEqual([]);
  });

  it("does not mark unreachable or source-less deficits", () => {
    const donor = sys("A", 0, { goodId: "food", stock: 100, logisticsTarget: 50, demand: 5 });
    const receiver = sys("far", 0, { goodId: "food", stock: 0, logisticsTarget: 10, demand: 5 });
    expect(matchFactionTransfers([donor, receiver], oneHop).fundingBound).toEqual([]);
  });

  it("continues classifying later deficits after the budget is exhausted", () => {
    const donor = sys("A", 2, { goodId: "food", stock: 100, logisticsTarget: 50, demand: 5 });
    const severe = sys("B", 0, { goodId: "food", stock: 0, logisticsTarget: 10, demand: 10 });
    const later = sys("C", 0, { goodId: "food", stock: 0, logisticsTarget: 10, demand: 1 });
    const result = matchFactionTransfers([donor, severe, later], oneHop);
    expect(result.transfers).toHaveLength(1);
    expect(result.fundingBound.map((match) => match.toSystemId)).toEqual(["B", "C"]);
  });

  it("limits zero-budget classification to bounded route candidates", () => {
    const donors = Array.from({ length: 100 }, (_value, index) =>
      sys(`S${index}`, 0, { goodId: "food", stock: 100, logisticsTarget: 50, demand: 5 }),
    );
    const receiver = sys("D", 0, { goodId: "food", stock: 0, logisticsTarget: 10, demand: 5 });
    let routeLookups = 0;
    const result = matchFactionTransfers(
      [...donors, receiver],
      () => {
        routeLookups++;
        return 1;
      },
      () => ["S0"],
    );

    expect(routeLookups).toBe(1);
    expect(result.fundingBound).toEqual([
      { goodId: "food", fromSystemId: "S0", toSystemId: "D" },
    ]);
  });

  it("fills one deficit from every willing donor in route-cost order, stopping each at its reserve", () => {
    // Two donors, each clearing the 1.4× margin on its reserve of 10 (stock 24 ≥ 14) with
    // 24 − 10 = 14 to spare. The deficit's shortfall of 30 exceeds either donor's drawable, so a
    // one-donor-per-deficit matcher leaves 16 standing beside reachable stock. The dear donor is
    // listed first: serving cheap before dear proves the fill is ordered by per-unit route cost,
    // not by input order.
    const dear = sys("dear", 1000, { goodId: "food", stock: 24, logisticsTarget: 10, demand: 5 });
    const cheap = sys("cheap", 0, { goodId: "food", stock: 24, logisticsTarget: 10, demand: 5 });
    const deficit = sys("B", 0, { goodId: "food", stock: 0, logisticsTarget: 30, demand: 5 });
    const costByDonor: RouteCost = (from) => (from === "cheap" ? 1 : 2);

    const { transfers } = matchFactionTransfers([dear, cheap, deficit], costByDonor);
    expect(transfers).toHaveLength(2);
    expect(transfers[0]).toMatchObject({ fromSystemId: "cheap", toSystemId: "B", quantity: 14, cost: 14 });
    expect(transfers[1]).toMatchObject({ fromSystemId: "dear", toSystemId: "B", quantity: 14, cost: 28 });
    // Neither donor is drawn past its reserve: each gave exactly stock 24 − reserve 10.
  });

  it("spends the remaining budget completing the current deficit before any later one", () => {
    // Budget 20 at 1 hop. The severe deficit's shortfall of 30 needs both donors (14 each); after
    // the first full draw (cost 14) the remaining 6 must go to the SAME deficit's second donor,
    // not skip ahead to the mild deficit — a budget-exhausted run stops mid-deficit.
    const d1 = sys("D1", 20, { goodId: "food", stock: 24, logisticsTarget: 10, demand: 5 });
    const d2 = sys("D2", 0, { goodId: "food", stock: 24, logisticsTarget: 10, demand: 5 });
    const severe = sys("B", 0, { goodId: "food", stock: 0, logisticsTarget: 30, demand: 10 });
    const mild = sys("C", 0, { goodId: "food", stock: 0, logisticsTarget: 10, demand: 1 });

    const { transfers } = matchFactionTransfers([d1, d2, severe, mild], oneHop);
    expect(transfers).toHaveLength(2);
    expect(transfers[0]).toMatchObject({ fromSystemId: "D1", toSystemId: "B", quantity: 14 });
    expect(transfers[1]).toMatchObject({ fromSystemId: "D2", toSystemId: "B", quantity: 6 });
    expect(transfers.some((t) => t.toSystemId === "C")).toBe(false);
  });

  it("breaks route-cost ties by stable system order, not enumeration order", () => {
    // In production `reachableSystemIds` enumerates the hop-BFS neighbourhood — NOT system
    // order — and a whole hop ring ties exactly on route cost, so the sort's order tie-break is
    // the only thing deciding which ring member ships first. Enumerate donors out of order to
    // prove the tie-break, not the enumeration, picks the winner.
    const d1 = sys("D1", 1000, { goodId: "food", stock: 24, logisticsTarget: 10, demand: 5 });
    const d2 = sys("D2", 0, { goodId: "food", stock: 24, logisticsTarget: 10, demand: 5 });
    const deficit = sys("B", 0, { goodId: "food", stock: 0, logisticsTarget: 30, demand: 5 });
    const enumeratesD2First: ReachableSystemIds = () => ["D2", "D1"];

    const { transfers } = matchFactionTransfers([d1, d2, deficit], oneHop, enumeratesD2First);
    expect(transfers).toHaveLength(2);
    expect(transfers[0]).toMatchObject({ fromSystemId: "D1", quantity: 14 });
    expect(transfers[1]).toMatchObject({ fromSystemId: "D2", quantity: 14 });
  });

  it("treats production exactly equal to demand as self-supplying (not a deficit sink) — the exact boundary", () => {
    // The self-supply gate's own equality boundary: production === demand exactly (not the
    // comfortably-above-demand 20-vs-5 the other self-supply test uses).
    const surplus = sys("A", 100, { goodId: "ore", stock: 100, logisticsTarget: 50, demand: 5, production: 0 });
    const producer = sys("B", 0, { goodId: "ore", stock: 2, logisticsTarget: 10, demand: 5, production: 5 });
    expect(matchFactionTransfers([surplus, producer], oneHop).transfers).toHaveLength(0);
  });

  it("excludes a donor whose route cost is exactly zero, like an unreachable one", () => {
    // perUnit === 0 sits on the `perUnit <= 0` boundary — a free-cost route must be rejected the
    // same way a negative one would be, not treated as reachable-and-free.
    const donor = sys("A", 100, { goodId: "food", stock: 100, logisticsTarget: 50, demand: 5 });
    const deficit = sys("B", 0, { goodId: "food", stock: 0, logisticsTarget: 10, demand: 5 });
    const zeroCost: RouteCost = () => 0;
    expect(matchFactionTransfers([donor, deficit], zeroCost).transfers).toHaveLength(0);
  });

  it(
    "does not blame the donor whose own affordable share exactly matched what it owed (affordable === wanted)",
    () => {
      // D1's stock-limited share of the deficit (10, at 1/unit) exactly exhausts the faction's whole
      // budget (10) — D1 delivered everything it was asked for, so it is not the "stopped" donor.
      // D2 — genuinely unaffordable with nothing left — is the one the flag must name. A `<=`
      // softening of the boundary would instead blame D1 for a fully-served draw and never even
      // look at D2.
      const d1 = sys("D1", 10, { goodId: "food", stock: 10, logisticsTarget: 0, donorReserve: 0, demand: 0 });
      const d2 = sys("D2", 0, { goodId: "food", stock: 20, logisticsTarget: 0, donorReserve: 0, demand: 0 });
      const deficit = sys("B", 0, { goodId: "food", stock: 0, logisticsTarget: 25, demand: 5 });
      const costByDonor: RouteCost = (from) => (from === "D1" ? 1 : 2);

      const result = matchFactionTransfers([d1, d2, deficit], costByDonor);
      expect(result.transfers).toEqual([
        { goodId: "food", fromSystemId: "D1", toSystemId: "B", quantity: 10, cost: 10 },
      ]);
      expect(result.fundingBound).toEqual([
        { goodId: "food", fromSystemId: "D2", toSystemId: "B" },
      ]);
    },
  );

  it("ranks the import queue by draw urgency, not by standing use", () => {
    // Two deficits with identical shortfall and identical use figures; only their ability to
    // consume the delivery right now differs. `idle`'s consuming industry is braked shut, so
    // `running` must be served first even though both worlds want the good equally in the long run.
    //
    // `idle` is listed first on purpose: a severity weight still reading `demand` leaves the two
    // tied, and the stable sort then serves whichever came first.
    const donor = sys("A", 10, { goodId: "ore", stock: 100, logisticsTarget: 50, demand: 5 });
    const idle = sys("idle", 0, { goodId: "ore", stock: 0, logisticsTarget: 10, demand: 5, drawDemand: 0.5 });
    const running = sys("running", 0, { goodId: "ore", stock: 0, logisticsTarget: 10, demand: 5, drawDemand: 5 });

    // Budget 10 at 1 hop covers exactly one of the two 10-unit shortfalls.
    const { transfers } = matchFactionTransfers([idle, running, donor], oneHop);
    expect(transfers).toHaveLength(1);
    expect(transfers[0].toSystemId).toBe("running");
    expect(transfers[0].quantity).toBe(10);
  });

});

// The temporary/structural distinction: `logisticsFundingBound` means "the work budget stopped a fill
// that had enough reachable capacity to succeed"; `unservable` means "reachable donors and local
// production together cannot supply this even with unlimited budget". Every fixture below is sized so
// the two constraints genuinely differ — a donor generous enough that budget alone binds (Entry 1), or
// so thin that no budget could ever be enough (Entry 3) — rather than two shapes that both happen to
// be structurally unservable.
describe("matchFactionTransfers — the unservable result (structural vs. funding-bound)", () => {
  it("reports fundingBound but NOT unservable when reachable capacity is ample and only the work budget binds", () => {
    // D1 alone can drawable 190 — comfortably more than B's 50-unit shortfall — so the shortfall is
    // closeable in principle; only the faction's small budget (20) stops the fill short.
    const d1 = sys("D1", 20, { goodId: "food", stock: 200, logisticsTarget: 10, demand: 5 });
    const b = sys("B", 0, { goodId: "food", stock: 0, logisticsTarget: 50, demand: 5 });

    const result = matchFactionTransfers([d1, b], oneHop);
    expect(result.transfers).toEqual([
      { goodId: "food", fromSystemId: "D1", toSystemId: "B", quantity: 20, cost: 20 },
    ]);
    expect(result.fundingBound).toEqual([{ goodId: "food", fromSystemId: "D1", toSystemId: "B" }]);
    expect(result.unservable).toEqual([]);
  });

  it("reports unservable, not fundingBound, for a deficit with no donor anywhere and no local production", () => {
    // B alone: no other system in the match holds this good at all, so `surplusesByGood` has no
    // entry for it — the plainest structural case. Local production is 0 < demand by construction
    // (sys()'s default), which is also what put B in the deficit queue at all.
    const b = sys("B", 0, { goodId: "food", stock: 0, logisticsTarget: 50, demand: 5 });

    const result = matchFactionTransfers([b], oneHop);
    expect(result.transfers).toEqual([]);
    expect(result.fundingBound).toEqual([]);
    expect(result.unservable).toEqual([{ goodId: "food", systemId: "B", shortfall: 50 }]);
  });

  it("can report both at once — reachable capacity is jointly too small AND the budget also runs out before reaching it — but never names the donor unservable", () => {
    // D1's whole drawable (40) is already short of B's shortfall (200): even an infinite budget could
    // not close this deficit from D1 alone. The budget (10) ALSO runs out partway through D1's own
    // draw, so the same haul independently qualifies as funding-bound too. The deficit endpoint (B)
    // carries both readings; the donor (D1) carries only the funding-bound one — a donor has no
    // reading about ITS OWN local demand being unservable.
    //
    // The two readings are sized off different quantities, and the figures show it: the structural
    // level is 160 — the 200 B wants less the 40 that exists to send it — while the 30 units the
    // budget kept from moving are funding-bound, not unservable. The level never reads 200: 40 of
    // that want is closeable, and money is the only thing standing in the way of it.
    const d1 = sys("D1", 10, { goodId: "food", stock: 50, logisticsTarget: 10, demand: 5 });
    const b = sys("B", 0, { goodId: "food", stock: 0, logisticsTarget: 200, demand: 5 });

    const result = matchFactionTransfers([d1, b], oneHop);
    expect(result.transfers).toEqual([
      { goodId: "food", fromSystemId: "D1", toSystemId: "B", quantity: 10, cost: 10 },
    ]);
    expect(result.fundingBound).toEqual([{ goodId: "food", fromSystemId: "D1", toSystemId: "B" }]);
    expect(result.unservable).toEqual([{ goodId: "food", systemId: "B", shortfall: 160 }]);
  });

  it("flags a deficit left with nothing when the faction's aggregate demand for a good exceeds its aggregate supply", () => {
    // The case a per-deficit reading taken against each donor's PRE-RUN capacity cannot see: one
    // donor holding 100, two deficits wanting 100 each. D1 empties the donor, D2 receives not one
    // unit, and no capacity for it exists anywhere in the faction — so D2 is unservable in the
    // plainest sense there is, at its whole want. Asked "could this be closed if D2 were the only
    // one asking", the answer is yes and D2 goes unreported through every channel: it is not
    // funding-bound either (generation 1000 against 100 units at 1 hop is ample), so nothing at all
    // would name a system that got zero.
    //
    // D1 and D2 are identical, so the queue's stable sort serves the one listed first; which of the
    // two starves is arbitrary, that exactly one does is not.
    const donor = sys("A", 1000, { goodId: "food", stock: 150, logisticsTarget: 50, demand: 5 });
    const d1 = sys("D1", 0, { goodId: "food", stock: 0, logisticsTarget: 100, demand: 5 });
    const d2 = sys("D2", 0, { goodId: "food", stock: 0, logisticsTarget: 100, demand: 5 });

    const result = matchFactionTransfers([donor, d1, d2], oneHop);

    expect(result.transfers).toEqual([
      { goodId: "food", fromSystemId: "A", toSystemId: "D1", quantity: 100, cost: 100 },
    ]);
    expect(result.fundingBound).toEqual([]);
    // D2 got nothing and says so at full size; D1, served whole from capacity that did exist for it,
    // carries no structural reading at all.
    expect(result.unservable).toEqual([{ goodId: "food", systemId: "D2", shortfall: 100 }]);
  });

  it("reports the structural GAP, not the whole want, for a deficit a shared donor served in part", () => {
    // Three deficits of one good sharing one donor, walked worst-first. The donor holds 100 before
    // the run; D1 takes 80 of it, D2 draws the remaining 20 and ends up short 30, and D3 finds a
    // donor with nothing left. The levels are what each is actually left missing — 30 and 10, not
    // the 50 and 10 they asked for — because the part a donor did cover is not unserved. D1, whose
    // want was met in full, carries nothing.
    //
    // Sizing the levels off the wants instead would report 60 unserved against a faction that is
    // short exactly 40 (140 wanted, 100 held), and would put D2 ahead of a genuinely worse deficit
    // in the alert bar's largest-shortfall-first sort. Budget is ample throughout (generation 1000
    // against 100 units at 1 hop), so nothing here is funding-bound and the two mechanisms cannot be
    // confused for one another.
    const donor = sys("A", 1000, { goodId: "food", stock: 150, logisticsTarget: 50, demand: 5 });
    const d1 = sys("D1", 0, { goodId: "food", stock: 0, logisticsTarget: 80, demand: 5 });
    const d2 = sys("D2", 0, { goodId: "food", stock: 0, logisticsTarget: 50, demand: 5 });
    const d3 = sys("D3", 0, { goodId: "food", stock: 0, logisticsTarget: 10, demand: 5 });

    const result = matchFactionTransfers([donor, d1, d2, d3], oneHop);

    // The contention itself: D1 is served whole, D2 gets only what is left, D3 nothing.
    expect(result.transfers).toEqual([
      { goodId: "food", fromSystemId: "A", toSystemId: "D1", quantity: 80, cost: 80 },
      { goodId: "food", fromSystemId: "A", toSystemId: "D2", quantity: 20, cost: 20 },
    ]);
    expect(result.fundingBound).toEqual([]);
    expect(result.unservable).toEqual([
      { goodId: "food", systemId: "D2", shortfall: 30 },
      { goodId: "food", systemId: "D3", shortfall: 10 },
    ]);
    // The levels add up to the faction's own gap in this good — 140 wanted against 100 held — which
    // is the property that makes them summable at all.
    const flagged = result.unservable.reduce((sum, u) => sum + u.shortfall, 0);
    expect(flagged).toBe(140 - 100);
  });

  it("emits one unservable entry per good on the same system, each carrying its OWN shortfall figure — de-duplicating to one system, and picking the largest, belongs to the read layer, not here", () => {
    // Targets deliberately differ per good so the three shortfalls are distinguishable — proving each
    // entry carries its own level, not one shared reading a "largest of three" read could
    // not actually distinguish.
    const targets: Record<string, number> = { food: 50, water: 80, ore: 30 };
    const threeDeficits: SystemLogisticsState = {
      systemId: "B",
      factionId: "f1",
      generation: 0,
      goods: ["food", "water", "ore"].map((goodId) => ({
        goodId, stock: 0, logisticsTarget: targets[goodId], demand: 5, drawDemand: 5, civilianDemand: 5,
        donorReserve: 10, production: 0, capacityProduction: 0,
      })),
    };

    const result = matchFactionTransfers([threeDeficits], oneHop);
    expect(result.unservable).toHaveLength(3);
    expect(result.unservable.every((u) => u.systemId === "B")).toBe(true);
    expect(new Set(result.unservable.map((u) => u.goodId))).toEqual(new Set(["food", "water", "ore"]));
    const shortfallByGood = new Map(result.unservable.map((u) => [u.goodId, u.shortfall]));
    expect(shortfallByGood).toEqual(new Map([["food", 50], ["water", 80], ["ore", 30]]));
  });
});

// Direct coverage of the donor test shared by the logistics matcher AND the build planner.
// The two-path rule (clears-margin OR structural-producer-above-reserve) and its guards are
// pinned here so a boundary mutation — e.g. the structural-producer `>` softening to `>=` —
// fails a test rather than silently regressing directed logistics. Every figure the function
// takes is demand-denominated; the price anchor does not appear in its signature at all, which
// is what makes the donor rule structurally immune to `anchor_shift` events.
/** What a structural exporter holds back: EXPORT_RESERVE_COVER cycles of its own demand. */
const exporterReserve = (demand: number) => DIRECTED_LOGISTICS.EXPORT_RESERVE_COVER * demand;

describe("surplusDrawable", () => {
  const margin = DIRECTED_LOGISTICS.SURPLUS_MARGIN; // 1.4

  it("keeps ordinary stock-holders at their reserve", () => {
    expect(surplusDrawable(100, 100, 5, 0)).toBe(0);
    expect(surplusDrawable(90, 100, 5, 0)).toBe(0);
  });

  it("path (a): any holder clearing the surplus margin donates stock above its reserve", () => {
    // stock 150 ≥ 100 × 1.4 = 140 → clears margin; non-producer still donates 150 − 100 = 50.
    expect(surplusDrawable(100 * margin + 10, 100, 5, 0)).toBe(100 * margin + 10 - 100);
  });

  it("path (b): a structural producer above its reserve donates even below the 1.4× margin", () => {
    // stock 110 = 1.1× reserve (below 140), production 30 > demand 5 → drawable is everything above
    // the exporter's own reserve (EXPORT_RESERVE_COVER cycles of demand 5).
    expect(surplusDrawable(110, 100, 5, 30)).toBe(110 - exporterReserve(5));
  });

  it("excludes a non-producer sitting in the 1.0–1.4× band (no re-export churn)", () => {
    // stock 110 in-band, production 0 ≤ demand 5, doesn't clear the margin → not drawable.
    expect(surplusDrawable(110, 100, 5, 0)).toBe(0);
  });

  it("excludes the production == demand boundary in-band (a balanced self-supplier is not a donor)", () => {
    // Pins the strict `production > demand`: equal production must NOT qualify as path (b).
    expect(surplusDrawable(110, 100, 5, 5)).toBe(0);
    // A hair above demand DOES qualify — confirms the boundary sits exactly at equality.
    expect(surplusDrawable(110, 100, 5, 5.01)).toBe(110 - exporterReserve(5));
  });
});

describe("strategic exporter reserve", () => {
  it("draws a structural exporter below its donor floor down to its own reserve, keeping exactly the reserve", () => {
    const floor = 100;
    const demand = 5;
    const stock = floor * 0.9;
    const drawable = surplusDrawable(stock, floor, demand, 30);
    expect(drawable).toBeCloseTo(stock - exporterReserve(demand));
    expect(stock - drawable).toBeCloseTo(exporterReserve(demand));
  });

  it("draws a producer below its donor floor down to the reserve, where a non-producer draws nothing", () => {
    const floor = 100;
    const demand = 5;
    const stock = exporterReserve(demand) + 30; // between the exporter reserve and the donor floor
    // A producer above demand deep-draws past the donor floor down to its reserve — it stops AT the
    // reserve, not the floor an ordinary donor would keep.
    expect(surplusDrawable(stock, floor, demand, 30)).toBeCloseTo(30);
    // The same stock with no production draws nothing — the ordinary path needs stock above its reserve.
    expect(surplusDrawable(stock, floor, demand, 0)).toBe(0);
  });

  it("does not deep-draw an input-starved former exporter despite its capacity", () => {
    const donor = sys("A", 100, {
      goodId: "ore", stock: 110, logisticsTarget: 100, demand: 5,
      production: 0, capacityProduction: 30,
    });
    const receiver = sys("B", 0, { goodId: "ore", stock: 0, logisticsTarget: 10, demand: 5 });
    expect(matchFactionTransfers([donor, receiver], oneHop).transfers).toEqual([]);
  });

  it("does not deep-draw a suppressed structural producer", () => {
    expect(surplusDrawable(110, 100, 5, 30, true)).toBe(0);
  });

  it("keeps its own suppression meaning, distinct from the build planner's", () => {
    // Two questions, two answers, deliberately not unified. Here the question is a DRAWDOWN — may we
    // ship this system down past its donor floor as a free-flowing exporter? — and a struck producer
    // is refused, because the output backing that reserve has stopped arriving. The build planner asks
    // whether a strike EXPLAINS a shortfall, which is only ever true where the system already holds
    // capacity in the good; a struck system with no capacity is still given the industry it lacks.
    // Collapsing the two would either deep-draw a striking exporter or freeze a striking world out of
    // construction entirely.
    const unsuppressed = surplusDrawable(110, 100, 5, 30, false);
    expect(unsuppressed).toBeGreaterThan(0);         // structural exporter: ships to its reserve
    expect(surplusDrawable(110, 100, 5, 30, true)).toBeLessThan(unsuppressed);
    // The flag only ever gates the structural-exporter fast path: a donor whose production does not
    // exceed its demand is on the ordinary path either way, so suppression changes nothing there.
    expect(surplusDrawable(150, 100, 5, 0, true)).toBe(surplusDrawable(150, 100, 5, 0, false));
  });

  it("keeps suppressed and realized-zero former exporters on the ordinary excess path", () => {
    const recipient = sys("B", 0, { goodId: "ore", stock: 0, logisticsTarget: 100, demand: 5 });
    const suppressed = sys("A", 100, {
      goodId: "ore", stock: 150, logisticsTarget: 100, demand: 5,
      production: 30, capacityProduction: 30, productionSuppressed: true,
    });
    const realizedZero = sys("C", 100, {
      goodId: "ore", stock: 150, logisticsTarget: 100, demand: 5,
      production: 0, capacityProduction: 30,
    });

    const suppressedTransfer = matchFactionTransfers([suppressed, recipient], oneHop).transfers[0];
    const realizedZeroTransfer = matchFactionTransfers([realizedZero, recipient], oneHop).transfers[0];
    expect(suppressedTransfer.quantity).toBe(50);
    expect(realizedZeroTransfer.quantity).toBe(50);
  });

  it("reserves nothing for a good with no local demand left, and pins that it is deliberate", () => {
    // Both reserves are cycles of the system's OWN demand, so a good nobody here consumes any more
    // reserves nothing and the whole pile is drawable — on either branch. Reachable in the lag window
    // after a good's last local consumer decays away. Correct — there is no local population to hold
    // stock for — but pinned so a future change cannot flip it silently.
    expect(surplusDrawable(500, 0, 0, 30)).toBe(500);
    expect(surplusDrawable(500, 0, 0, 0)).toBe(500); // ordinary donor: margin on 0 is vacuous
  });

  it("keeps the strategic reserve safely above ration cover", () => {
    // Both are cycles of cover, so they compare directly — exporting must never ration the exporter.
    expect(DIRECTED_LOGISTICS.EXPORT_RESERVE_COVER).toBeGreaterThan(ECONOMY_CONSTANTS.RATION_COVER);
  });

  it("keeps the reserve below the pricing anchor, so an exporter is never held above its own anchor", () => {
    expect(DIRECTED_LOGISTICS.EXPORT_RESERVE_COVER).toBeLessThan(TARGET_COVER);
  });
});