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
  },
): SystemLogisticsState {
  const production = good.production ?? 0;
  return {
    systemId, factionId: "f1", generation,
    goods: [{
      ...good,
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