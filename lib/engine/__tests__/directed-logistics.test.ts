import { describe, it, expect } from "vitest";
import {
  systemLogisticsGeneration,
  matchFactionTransfers,
  classifyMarketState,
  surplusDrawable,
  countedStock,
  orderCover,
  levelCover,
  goodsInNecessityOrder,
  type SystemLogisticsState,
  type RouteBookerFor,
  type GoodMarketState,
} from "@/lib/engine/directed-logistics";
import { DIRECTED_LOGISTICS } from "@/lib/constants/directed-logistics";
import { ECONOMY_CONSTANTS, TARGET_COVER } from "@/lib/constants/economy";
import { GOOD_NECESSITY } from "@/lib/constants/physical-economy";

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
    /** Goods already dispatched toward this system for this good — read only by the sink
     *  classification (`stock + scheduledInbound` vs `logisticsTarget`). Defaults to 0 (no fixture
     *  predating the inbound-aware sink test has anything in flight). */
    scheduledInbound?: number;
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

/**
 * Build a `RouteBookerFor` fake from a plain per-unit price function, for tests that don't care
 * about congestion. `place`, when given, caps what `routeAndBook` actually places (simulating a
 * saturated lane) — the excess is reported `blocked`, never billed or drawn, exactly as a real
 * `RouteBooker` would. Defaults to placing the whole requested quantity.
 *
 * `reachable`, when given, is the fake's `reachableFrom` predicate — independent of `price`, so a
 * test can simulate a donor whose path exists but is currently saturated (`price` null,
 * `reachable` true) as well as a genuinely closed donor (both null/false). Defaults to mirroring
 * `price !== null`, matching every fixture predating the reachable/price split, where the two never
 * diverged.
 */
function makeBooker(opts: {
  price: (from: string, to: string) => number | null;
  place?: (from: string, to: string, quantity: number) => number;
  reachable?: (from: string, to: string) => boolean;
}): RouteBookerFor {
  return {
    priceFrom: (sinkId: string) => (donorId: string) => opts.price(donorId, sinkId),
    reachableFrom: (sinkId: string) => (donorId: string) =>
      opts.reachable ? opts.reachable(donorId, sinkId) : opts.price(donorId, sinkId) !== null,
    routeAndBook: (from: string, to: string, quantity: number) => {
      if (from === to || quantity <= 0) return null;
      const perUnit = opts.price(from, to);
      if (perUnit === null) return null;
      const placed = Math.min(opts.place ? opts.place(from, to, quantity) : quantity, quantity);
      const key = `${from}->${to}`;
      return {
        placements: placed > 0 ? [{ quantity: placed, edges: [key], perUnit, fuelTotal: placed }] : [],
        blocked: quantity - placed > 0 ? [{ laneKey: key, quantity: quantity - placed, foreignShare: 0 }] : [],
      };
    },
  };
}

/** A booker with no congestion: whatever is requested is fully placed at the given per-unit cost. */
function costBooker(cost: (from: string, to: string) => number | null): RouteBookerFor {
  return makeBooker({ price: cost });
}

// Unit cost = hops; 1 hop between any two systems, unreachable for "far".
const oneHopCost = (_from: string, to: string): number | null => (to === "far" ? null : 1);
const oneHop = costBooker(oneHopCost);

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

  it("serves the emptiest shelf first when the budget is scarce, not the largest shortfall", () => {
    // A: stock 100 ≥ logisticsTarget 50 × 1.4 = 70 ✓ surplus; drawable 50.
    // `big` is 300 units short with a draw of 10/cycle — by far the largest want in the faction —
    // but it still holds 10 cycles of cover. `empty` wants only 36 and is down to 4 cycles. The
    // budget (10 at 1 hop) funds one draw, and it goes to the shelf closest to running out: the
    // deficit queue is ordered by cover, not by how much a world is missing.
    const surplus = sys("A", 10, { goodId: "food", stock: 100, logisticsTarget: 50, demand: 1 });
    const big = sys("big", 0, { goodId: "food", stock: 100, logisticsTarget: 400, demand: 10 });
    const empty = sys("empty", 0, { goodId: "food", stock: 4, logisticsTarget: 40, demand: 1 });
    const { transfers, budgetSkipped } = matchFactionTransfers([surplus, big, empty], oneHop);
    expect(transfers).toHaveLength(1);
    expect(transfers[0].toSystemId).toBe("empty");
    // The level over the 50 available sits at 14 cycles, so `empty`'s raise is 10 — the whole
    // budget — and `big`'s 40-unit raise is left unfunded.
    expect(transfers[0].quantity).toBeCloseTo(10, 8);
    expect(budgetSkipped).toBe(1);
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
    // C at 0.4 cycles of cover (demand 10), B at 4 (demand 1); each: stock 4 < 10 × 0.8 = 8 ✓
    // deficit, shortfall = 6.
    const severe = sys("C", 0, { goodId: "food", stock: 4, logisticsTarget: 10, demand: 10 });
    const mild = sys("B", 0, { goodId: "food", stock: 4, logisticsTarget: 10, demand: 1 });
    const { transfers } = matchFactionTransfers([surplus, severe, mild], oneHop);
    // C is drawn first (0.4 cycles against B's 4) and the level of 8 cycles is above its own
    // 1-cycle target, so it takes its whole shortfall of 6; B draws its raise from A's residual
    // drawable (10 − 6 = 4). Proves the source is not over-drawn below its own target across the
    // pass — the two draws sum to exactly what A had to give.
    expect(transfers).toHaveLength(2);
    expect(transfers[0]).toMatchObject({ fromSystemId: "A", toSystemId: "C", quantity: 6 });
    expect(transfers[1]).toMatchObject({ fromSystemId: "A", toSystemId: "B" });
    // A levelled raise is solved in cycles and multiplied back out, so it carries the solver's last
    // bit of float; the drawable bound it respects does not.
    expect(transfers[1].quantity).toBeCloseTo(4, 8);
    expect(transfers[0].quantity + transfers[1].quantity).toBeLessThanOrEqual(10);
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
    // residual of 5. Reachable supply covers the whole want here, so the raise IS the 100-unit
    // shortfall and the residual is 5% of it — under FUNDING_BOUND_RESIDUAL_FRACTION (10%).
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

  it("measures the funding-bound residual against the raise the budget stopped, not the whole shortfall to the target", () => {
    // S is 40 cycles short of its warehousing target (200 units at 5/cycle), but the faction's
    // reachable supply of the good is 15 units — 3 cycles — so 3 cycles is the raise it is being
    // levelled to and the whole of what money could possibly deliver this run.
    const SHORTFALL = 200;
    const RAISE = 15;
    const residualFraction = DIRECTED_LOGISTICS.FUNDING_BOUND_RESIDUAL_FRACTION;

    // Half of that raise goes unplaced because the budget (7.5) runs out mid-draw. Half a raise
    // missing IS "this shortfall persists because of money", and the gameplay gates the flag drives
    // (planner suppression, the idle-decay exemption) must see it.
    const halted = sys("D", RAISE / 2, { goodId: "food", stock: 25, logisticsTarget: 10, demand: 5 });
    const sink = sys("S", 0, { goodId: "food", stock: 0, logisticsTarget: SHORTFALL, demand: 5 });

    const material = matchFactionTransfers([halted, sink], oneHop);
    expect(material.transfers).toMatchObject([
      { goodId: "food", fromSystemId: "D", toSystemId: "S", quantity: RAISE / 2 },
    ]);
    expect(material.fundingBound).toEqual([{ goodId: "food", fromSystemId: "D", toSystemId: "S" }]);
    // Discrimination: the retired denominator would have called the same stop immaterial, because
    // 7.5 units is a rounding error against a 200-unit shortfall — and would have cleared the flag
    // on every world under a scarce good, which is exactly the population it exists to mark.
    expect(RAISE / 2).toBeLessThan(SHORTFALL * residualFraction);
    expect(RAISE / 2).toBeGreaterThan(RAISE * residualFraction);

    // The same stop with 5% of the raise left standing is not material: the world was raised to
    // within a twentieth of everything the faction had to give it, and money is not what is keeping
    // it short. (Here the retired denominator agrees — with the raise never larger than the
    // shortfall, re-denominating can only ever turn a missed flag into a set one.)
    const nearlyDone = sys("D", RAISE * 0.95, { goodId: "food", stock: 25, logisticsTarget: 10, demand: 5 });
    const trivial = matchFactionTransfers([nearlyDone, sink], oneHop);
    expect(trivial.transfers).toMatchObject([
      { goodId: "food", fromSystemId: "D", toSystemId: "S", quantity: RAISE * 0.95 },
    ]);
    expect(trivial.fundingBound).toEqual([]);
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

  it("fills one deficit from every willing donor in route-cost order, stopping each at its reserve", () => {
    // Two donors, each clearing the 1.4× margin on its reserve of 10 (stock 24 ≥ 14) with
    // 24 − 10 = 14 to spare. The deficit's shortfall of 30 exceeds either donor's drawable, so a
    // one-donor-per-deficit matcher leaves 16 standing beside reachable stock. The dear donor is
    // listed first: serving cheap before dear proves the fill is ordered by per-unit route cost,
    // not by input order.
    const dear = sys("dear", 1000, { goodId: "food", stock: 24, logisticsTarget: 10, demand: 5 });
    const cheap = sys("cheap", 0, { goodId: "food", stock: 24, logisticsTarget: 10, demand: 5 });
    const deficit = sys("B", 0, { goodId: "food", stock: 0, logisticsTarget: 30, demand: 5 });
    const costByDonor = (from: string) => (from === "cheap" ? 1 : 2);

    const { transfers } = matchFactionTransfers([dear, cheap, deficit], costBooker(costByDonor));
    expect(transfers).toHaveLength(2);
    expect(transfers[0]).toMatchObject({ fromSystemId: "cheap", toSystemId: "B", quantity: 14, cost: 14 });
    expect(transfers[1]).toMatchObject({ fromSystemId: "dear", toSystemId: "B", quantity: 14, cost: 28 });
    // Neither donor is drawn past its reserve: each gave exactly stock 24 − reserve 10.
  });

  it("spends the remaining budget completing the current deficit before any later one", () => {
    // Budget 20 at 1 hop. B is drawn first (0 cycles of cover against C's 0, tie broken by input
    // order) and its raise of ~25 needs both donors (14 each); after the first full draw (cost 14)
    // the remaining 6 must go to the SAME deficit's second donor, not skip ahead to C — a
    // budget-exhausted run stops mid-deficit.
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

  it("breaks route-cost ties by stable system order, not donor-map iteration order", () => {
    // Two donors tie exactly on route cost, so the sort's `source.order` tie-break — the system's
    // position in the input array — is the only thing deciding which one ships first. D1 is listed
    // first in `systems`, so it must ship first despite D2 holding the same stock and price.
    const d1 = sys("D1", 1000, { goodId: "food", stock: 24, logisticsTarget: 10, demand: 5 });
    const d2 = sys("D2", 0, { goodId: "food", stock: 24, logisticsTarget: 10, demand: 5 });
    const deficit = sys("B", 0, { goodId: "food", stock: 0, logisticsTarget: 30, demand: 5 });

    const { transfers } = matchFactionTransfers([d1, d2, deficit], oneHop);
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
      const costByDonor = (from: string) => (from === "D1" ? 1 : 2);

      const result = matchFactionTransfers([d1, d2, deficit], costBooker(costByDonor));
      expect(result.transfers).toMatchObject([
        { goodId: "food", fromSystemId: "D1", toSystemId: "B", quantity: 10, cost: 10 },
      ]);
      expect(result.fundingBound).toEqual([
        { goodId: "food", fromSystemId: "D2", toSystemId: "B" },
      ]);
    },
  );

  it("ranks the import queue by draw urgency, not by standing use", () => {
    // Two deficits with identical stock, shortfall and use figures; only their ability to consume
    // the delivery right now differs. `idle`'s consuming industry is braked shut, so at the same 5
    // units on the shelf it has 10 cycles of cover at its braked draw where `running` has 1 —
    // `running` must be drawn first even though both worlds want the good equally in the long run.
    //
    // `idle` is listed first on purpose: an order reading `demand` leaves the two tied, and the
    // stable sort then serves whichever came first.
    const donor = sys("A", 5, { goodId: "ore", stock: 100, logisticsTarget: 50, demand: 5 });
    const idle = sys("idle", 0, { goodId: "ore", stock: 5, logisticsTarget: 10, demand: 5, drawDemand: 0.5 });
    const running = sys("running", 0, { goodId: "ore", stock: 5, logisticsTarget: 10, demand: 5, drawDemand: 5 });

    // Budget 5 at 1 hop covers exactly one of the two 5-unit raises.
    const { transfers } = matchFactionTransfers([idle, running, donor], oneHop);
    expect(transfers).toHaveLength(1);
    expect(transfers[0].toSystemId).toBe("running");
    expect(transfers[0].quantity).toBe(5);
  });

});

describe("matchFactionTransfers — levelling the shelves within a good", () => {
  /** Cycles of cover a sink ends the run on: what it held plus everything it drew, over its use. */
  const endingCover = (
    transfers: Array<{ toSystemId: string; quantity: number }>,
    systemId: string,
    stock: number,
    demand: number,
  ): number =>
    (stock + transfers.filter((t) => t.toSystemId === systemId)
      .reduce((sum, t) => sum + t.quantity, 0)) / demand;

  it("levels two deficits at different covers onto a common cover instead of filling the emptier to its target", () => {
    // A holds 40 drawable against 160 of want — enough for neither world's target. `low` starts at
    // 2 cycles of cover, `high` at 6; the level lands at 8, so `low` draws 30 and `high` 10 and
    // both end on the same shelf. Worst-first would have handed all 40 to `low` (severity 450
    // against 350) and left `high` with nothing — the cliff this exists to remove.
    const donor = sys("A", 1000, { goodId: "food", stock: 90, logisticsTarget: 50, demand: 5 });
    const low = sys("low", 0, { goodId: "food", stock: 10, logisticsTarget: 100, demand: 5 });
    const high = sys("high", 0, { goodId: "food", stock: 30, logisticsTarget: 100, demand: 5 });

    const { transfers } = matchFactionTransfers([donor, low, high], oneHop);
    expect(transfers).toHaveLength(2);
    expect(transfers[0]).toMatchObject({ toSystemId: "low" });
    expect(transfers[1]).toMatchObject({ toSystemId: "high" });
    expect(transfers[0].quantity).toBeCloseTo(30, 8);
    expect(transfers[1].quantity).toBeCloseTo(10, 8);
    expect(endingCover(transfers, "low", 10, 5)).toBeCloseTo(8, 8);
    expect(endingCover(transfers, "high", 30, 5)).toBeCloseTo(8, 8);
  });

  it("raises a small world at 4 cycles before a large one at 10, and a large world at 4 while a small one at 40 gets nothing", () => {
    // Cover is size-neutral in both directions. First: `small` uses 1/cycle and is 36 short,
    // `large` uses 10 and is 300 short — the donor's 4 units go to the smaller, emptier world,
    // because at 4 cycles it runs out first.
    const donorA = sys("A", 1000, { goodId: "food", stock: 14, logisticsTarget: 10, demand: 5 });
    const small = sys("small", 0, { goodId: "food", stock: 4, logisticsTarget: 40, demand: 1 });
    const large = sys("large", 0, { goodId: "food", stock: 100, logisticsTarget: 400, demand: 10 });

    const byCover = matchFactionTransfers([donorA, small, large], oneHop);
    expect(byCover.transfers).toHaveLength(1);
    expect(byCover.transfers[0]).toMatchObject({ toSystemId: "small" });
    expect(byCover.transfers[0].quantity).toBeCloseTo(4, 8);

    // Reversed: now the large world is the one at 4 cycles and the small one is comfortable at 40.
    // The whole 50 goes to the large world — raising it by one cycle costs ten times as much, which
    // is exactly what it needs to survive the same number of cycles.
    const donorB = sys("A", 1000, { goodId: "food", stock: 60, logisticsTarget: 10, demand: 5 });
    const emptyLarge = sys("large", 0, { goodId: "food", stock: 40, logisticsTarget: 400, demand: 10 });
    const comfySmall = sys("small", 0, { goodId: "food", stock: 40, logisticsTarget: 60, demand: 1 });

    const bySize = matchFactionTransfers([donorB, emptyLarge, comfySmall], oneHop);
    expect(bySize.transfers).toHaveLength(1);
    expect(bySize.transfers[0]).toMatchObject({ toSystemId: "large" });
    expect(bySize.transfers[0].quantity).toBeCloseTo(50, 8);
  });

  it("tops the first-drawn world up to the recomputed level when a later world's own donors run dry", () => {
    // W1 (0 cycles), W2 (12) and W3 (24) share a pool of 35, so the first level is 23.5: W1 draws
    // 23.5 from D1 and W2 asks D2 — the only donor it can reach — for 11.5 and gets the 5 it holds.
    // W2's level is fixed at 17 and it leaves the levelling; the level over the remaining 6.5 rises
    // to 27, and W1 is topped up 3.5 rather than left at 23.5 while W3 draws past it. A
    // single-pass implementation ends with W1 at 23.5 and W3 at 27.
    const d1 = sys("D1", 1000, { goodId: "food", stock: 40, logisticsTarget: 10, demand: 5 });
    const d2 = sys("D2", 0, { goodId: "food", stock: 15, logisticsTarget: 10, demand: 5 });
    const w1 = sys("W1", 0, { goodId: "food", stock: 0, logisticsTarget: 100, demand: 1 });
    const w2 = sys("W2", 0, { goodId: "food", stock: 12, logisticsTarget: 100, demand: 1 });
    const w3 = sys("W3", 0, { goodId: "food", stock: 24, logisticsTarget: 100, demand: 1 });
    const reaches = (from: string, to: string): boolean =>
      (from === "D1" && (to === "W1" || to === "W3")) || (from === "D2" && to === "W2");
    const booker = makeBooker({ price: (from, to) => (reaches(from, to) ? 1 : null) });

    const { transfers } = matchFactionTransfers([d1, d2, w1, w2, w3], booker);

    // W1 is drawn twice: its raise to the first level, then the top-up to the recomputed one.
    const toW1 = transfers.filter((t) => t.toSystemId === "W1");
    expect(toW1).toHaveLength(2);
    expect(toW1[0].quantity).toBeCloseTo(23.5, 8);
    expect(toW1[1].quantity).toBeCloseTo(3.5, 8);
    // The fixed point: the two worlds still in the levelling end on the same shelf, above the one
    // whose own donor ran dry.
    expect(endingCover(transfers, "W1", 0, 1)).toBeCloseTo(27, 6);
    expect(endingCover(transfers, "W3", 24, 1)).toBeCloseTo(27, 6);
    expect(endingCover(transfers, "W2", 12, 1)).toBeCloseTo(17, 8);
  });

  it("fills every deficit to its own target when supply covers them all, whatever their cover", () => {
    // The ample-supply case is unchanged by levelling: the level is the target, so both worlds take
    // their whole shortfall and the transfer set is the one worst-first order produced. The donor
    // holds 170 against 160 of want — ample, but only just, so a level solved against anything less
    // than the whole reachable pool stops short of the target and shows up here.
    const donor = sys("A", 1000, { goodId: "food", stock: 220, logisticsTarget: 50, demand: 5 });
    const low = sys("low", 0, { goodId: "food", stock: 10, logisticsTarget: 100, demand: 5 });
    const high = sys("high", 0, { goodId: "food", stock: 30, logisticsTarget: 100, demand: 5 });

    const { transfers, unservable } = matchFactionTransfers([donor, low, high], oneHop);
    expect(transfers).toMatchObject([
      { toSystemId: "low", quantity: 90 },
      { toSystemId: "high", quantity: 70 },
    ]);
    expect(unservable).toEqual([]);
  });

  it("draws a world with nothing leaving its shelf last, and still sizes its raise on its use figure", () => {
    // `idle` has the LOWER cover of the two on the level's own scale (5 cycles of use against
    // `busy`'s 8) but reads +Infinity on the draw scale — nothing is leaving its shelf right now —
    // so it is drawn after every world with a finite cover. Its raise is still sized on `demand`:
    // 15 cycles at 5/cycle = 75, which a raise denominated in the draw figure could not produce
    // at all.
    const donor = sys("A", 10_000, { goodId: "food", stock: 1000, logisticsTarget: 50, demand: 5 });
    const idle = sys("idle", 0, {
      goodId: "food", stock: 25, logisticsTarget: 100, demand: 5, drawDemand: 0,
    });
    const busy = sys("busy", 0, { goodId: "food", stock: 40, logisticsTarget: 100, demand: 5 });

    const { transfers } = matchFactionTransfers([donor, idle, busy], oneHop);
    expect(transfers.map((t) => t.toSystemId)).toEqual(["busy", "idle"]);
    expect(transfers[1].quantity).toBe(75);
  });

  it("counts a donor only a saturated path reaches in the pool that sets the level, without drawing or billing it", () => {
    // Dsat holds 30 drawable and W1 can structurally reach it, but its path is saturated
    // (`priceFrom` null) so nothing can cross this run. It still counts in the pool: the level over
    // 40 sits at 22.5, so W1's raise takes all 10 of the openly-routed donor and W2 — comfortable at
    // 5 cycles — gets nothing. Leaving the saturated supply out of the pool would put the level at
    // 7.5 and hand W2 2.5 units of a supply that was never really spare.
    const open = sys("Dopen", 1000, { goodId: "food", stock: 20, logisticsTarget: 10, demand: 5 });
    const saturated = sys("Dsat", 0, { goodId: "food", stock: 40, logisticsTarget: 10, demand: 5 });
    const w1 = sys("W1", 0, { goodId: "food", stock: 0, logisticsTarget: 100, demand: 1 });
    const w2 = sys("W2", 0, { goodId: "food", stock: 5, logisticsTarget: 100, demand: 1 });
    const booker = makeBooker({
      price: (from) => (from === "Dopen" ? 1 : null),
      reachable: (from, to) => from === "Dopen" || to === "W1",
    });

    const { transfers } = matchFactionTransfers([open, saturated, w1, w2], booker);
    expect(transfers).toMatchObject([
      { fromSystemId: "Dopen", toSystemId: "W1", quantity: 10, cost: 10 },
    ]);
    // The saturated donor's share is never drawn from it and never billed — the booker's blocked
    // volume, not this function's, is where a congestion loss is recorded.
    expect(transfers.every((t) => t.fromSystemId !== "Dsat")).toBe(true);
    expect(transfers.reduce((sum, t) => sum + t.cost, 0)).toBe(10);
  });

  it("still spends the pool on the second world when the first sits under the ration line, instead of stalling the level below its own reach", () => {
    // R's physical stock (5) sits under the ration line (RATION_COVER 2 × demand 5 = 10), so
    // `countedStock`/`levelCover` read physical stock alone (1 cycle) while its 70-unit
    // scheduledInbound still clears the sink test (`c.shortfall` reads stock + inbound), leaving it a
    // 25-unit remaining want (100 target − 5 stock − 70 inbound). Capping `targetCover` at
    // `levelCover + shortfall/demand` (6 cycles) rather than the bare `logisticsTarget/demand` (20)
    // is what lets the solver see R can only ever absorb those 25 units — uncapped, R reads as
    // wanting a cover it cannot reach on physical stock, the level lands under Q's own 10-cycle
    // levelCover, and Q draws nothing while 15 of the donor's 40 sit unspent.
    const donor = sys("A", 1000, { goodId: "food", stock: 40, logisticsTarget: 0, demand: 0, donorReserve: 0 });
    const r = sys("R", 0, {
      goodId: "food", stock: 5, logisticsTarget: 100, demand: 5, scheduledInbound: 70,
    });
    const q = sys("Q", 0, { goodId: "food", stock: 50, logisticsTarget: 100, demand: 5 });

    const { transfers, unservable } = matchFactionTransfers([donor, r, q], oneHop);
    expect(transfers).toMatchObject([
      { toSystemId: "R", quantity: 25 },
      { toSystemId: "Q", quantity: 15 },
    ]);
    expect(transfers.reduce((sum, t) => sum + t.quantity, 0)).toBe(40);
    // Q's 35-unit remaining want (50 shortfall − 15 drawn) is genuinely unservable once the donor's
    // 40 drawable is exhausted — not left on the table by an over-stated R.
    expect(unservable).toEqual([{ goodId: "food", systemId: "Q", shortfall: 35 }]);
  });
});

describe("goodsInNecessityOrder", () => {
  it("sorts a good absent from the necessity table last, not first, and never throws", () => {
    // The guard the ordering rests on: an unlisted good must read 0 — the bottom of the table —
    // rather than `undefined`, which would make every comparison NaN and the sort arbitrary.
    expect("unobtanium" in GOOD_NECESSITY).toBe(false);
    expect(goodsInNecessityOrder(["unobtanium", "luxuries", "water"]))
      .toEqual(["water", "luxuries", "unobtanium"]);
    expect(() => goodsInNecessityOrder(["unobtanium"])).not.toThrow();
    expect(goodsInNecessityOrder(["unobtanium"])).toEqual(["unobtanium"]);
  });
});

describe("matchFactionTransfers — goods in necessity order", () => {
  it("serves water before a less necessary good when the budget funds one of them, whichever is the more severe", () => {
    // The luxuries deficit is empty (0 cycles of cover) and wants 100; the water deficit is the
    // comfortable one at 8 cycles and wants 60. The budget funds 60 units at 1 hop — one of the two
    // raises. Necessity decides, not severity: the water raise is placed in full and the luxuries
    // one is budget-skipped. Luxuries is listed FIRST so the order the classification walk met the
    // goods in would serve exactly the wrong one.
    const dLux = sys("Dlux", 0, { goodId: "luxuries", stock: 150, logisticsTarget: 50, demand: 5 });
    const sLux = sys("Slux", 0, { goodId: "luxuries", stock: 0, logisticsTarget: 100, demand: 5 });
    const dWater = sys("Dwater", 60, { goodId: "water", stock: 150, logisticsTarget: 50, demand: 5 });
    const sWater = sys("Swater", 0, { goodId: "water", stock: 40, logisticsTarget: 100, demand: 5 });

    const byNecessity = matchFactionTransfers([dLux, sLux, dWater, sWater], oneHop);
    expect(byNecessity.transfers).toMatchObject([
      { goodId: "water", fromSystemId: "Dwater", toSystemId: "Swater", quantity: 60 },
    ]);
    expect(byNecessity.budgetSkipped).toBe(1);
    expect(byNecessity.fundingBound).toEqual([
      { goodId: "luxuries", fromSystemId: "Dlux", toSystemId: "Slux" },
    ]);

    // Within one necessity weight (metals and ore both sit at 0.1) the good id breaks the tie
    // ascending, so metals is served and ore skipped — again against both the input order and the
    // severity order, which would each pick ore.
    expect(GOOD_NECESSITY.metals).toBe(GOOD_NECESSITY.ore);
    const dOre = sys("Dore", 60, { goodId: "ore", stock: 150, logisticsTarget: 50, demand: 5 });
    const sOre = sys("Sore", 0, { goodId: "ore", stock: 0, logisticsTarget: 100, demand: 5 });
    const dMetals = sys("Dmetals", 0, { goodId: "metals", stock: 150, logisticsTarget: 50, demand: 5 });
    const sMetals = sys("Smetals", 0, { goodId: "metals", stock: 40, logisticsTarget: 100, demand: 5 });

    const byGoodId = matchFactionTransfers([dOre, sOre, dMetals, sMetals], oneHop);
    expect(byGoodId.transfers).toMatchObject([
      { goodId: "metals", fromSystemId: "Dmetals", toSystemId: "Smetals", quantity: 60 },
    ]);
    expect(byGoodId.budgetSkipped).toBe(1);
  });
});

describe("matchFactionTransfers — inbound-aware sink classification", () => {
  it("does not treat a sink as a deficit once enough goods are already in flight to clear the line, but does without that inbound", () => {
    // B: stock 2 < logisticsTarget 10 × 0.8 = 8 → deficit on physical stock alone. scheduledInbound 6
    // brings stock + inbound to 8 — exactly the threshold — clearing it (`8 < 8` is false), so B must
    // not re-order a delivery it is already receiving. C is the identical fixture with nothing in
    // flight, still a deficit — the only thing separating the two is the inbound term.
    const donor = sys("A", 100, { goodId: "food", stock: 100, logisticsTarget: 50, demand: 5 });
    const covered = sys("B", 0, {
      goodId: "food", stock: 2, logisticsTarget: 10, demand: 5, scheduledInbound: 6,
    });
    const uncovered = sys("C", 0, { goodId: "food", stock: 2, logisticsTarget: 10, demand: 5 });

    expect(matchFactionTransfers([donor, covered], oneHop).transfers).toEqual([]);
    const { transfers } = matchFactionTransfers([donor, uncovered], oneHop);
    expect(transfers).toHaveLength(1);
    expect(transfers[0].toSystemId).toBe("C");
  });

  it("gives nothing from a donor sitting at its reserve, regardless of how much of its own inbound is in flight", () => {
    // A's physical stock sits exactly at its reserve (surplusDrawable's `aboveReserve <= 0` branch),
    // so it donates 0 — the donor test never reads `scheduledInbound`, so a huge inbound figure on the
    // donor's own market must not inflate what it is willing to give.
    const atReserve = sys("A", 100, {
      goodId: "food", stock: 500, logisticsTarget: 10, donorReserve: 500, demand: 5,
      scheduledInbound: 500,
    });
    const deficit = sys("B", 0, { goodId: "food", stock: 0, logisticsTarget: 10, demand: 5 });
    expect(matchFactionTransfers([atReserve, deficit], oneHop).transfers).toEqual([]);
  });
});

describe("matchFactionTransfers — booked routing, the per-deficit skip, and blocked volume", () => {
  it("produces one transfer per placement when the booker splits a haul across paths, quantities summing to the draw", () => {
    const donor = sys("A", 100, { goodId: "food", stock: 100, logisticsTarget: 50, demand: 5 });
    const deficit = sys("B", 0, { goodId: "food", stock: 0, logisticsTarget: 10, demand: 5 });
    // shortfall = 10, drawable = 50, so the whole 10-unit draw is requested; the booker splits it
    // across two paths of its own choosing.
    const splitting: RouteBookerFor = {
      priceFrom: () => () => 2,
      reachableFrom: () => () => true,
      routeAndBook: (_from, _to, quantity) => ({
        placements: [
          { quantity: quantity * 0.6, edges: ["p1"], perUnit: 2, fuelTotal: 3 },
          { quantity: quantity * 0.4, edges: ["p2"], perUnit: 3, fuelTotal: 5 },
        ],
        blocked: [],
      }),
    };

    const { transfers } = matchFactionTransfers([donor, deficit], splitting);
    expect(transfers).toHaveLength(2);
    expect(transfers[0]).toMatchObject({ fromSystemId: "A", toSystemId: "B", edges: ["p1"], fuelTotal: 3, cost: 12 });
    expect(transfers[1]).toMatchObject({ fromSystemId: "A", toSystemId: "B", edges: ["p2"], fuelTotal: 5, cost: 12 });
    const summed = transfers.reduce((sum, t) => sum + t.quantity, 0);
    expect(summed).toBeCloseTo(10, 10);
  });

  it("ends only the triggering deficit's fill on an unaffordable draw, leaving the remaining budget to fund a cheaper deficit behind it", () => {
    // Severe wants 1000 from D1 (drawable 1000, frozen price 2). Budget 20 can only afford 10 of it —
    // an unaffordable draw — and the lane is congested to boot: the booker places only 4 of the
    // requested 10, blocking the rest. Only the PLACED cost (4 × 2 = 8) is billed, leaving a genuine
    // 12 of budget for Mild — proving the skip does not zero the pool the way the retired
    // `budget = 0; break` clamp did (see the red-proof arm in the task notes).
    const severe = sys("Severe", 0, { goodId: "food", stock: 0, logisticsTarget: 1000, demand: 5 });
    const d1 = sys("D1", 20, { goodId: "food", stock: 1100, logisticsTarget: 100, demand: 5 });
    const mild = sys("Mild", 0, { goodId: "food", stock: 0, logisticsTarget: 5, demand: 1 });
    const d2 = sys("D2", 0, { goodId: "food", stock: 100, logisticsTarget: 10, demand: 5 });

    const booker: RouteBookerFor = {
      priceFrom: (sinkId) => (donorId) => {
        if (sinkId === "Severe" && donorId === "D1") return 2;
        if (sinkId === "Mild" && donorId === "D2") return 1;
        return null;
      },
      reachableFrom: (sinkId) => (donorId) =>
        (sinkId === "Severe" && donorId === "D1") || (sinkId === "Mild" && donorId === "D2"),
      routeAndBook: (from, to, quantity) => {
        if (from === "D1" && to === "Severe") {
          const placed = Math.min(quantity, 4);
          return {
            placements: [{ quantity: placed, edges: ["choke"], perUnit: 2, fuelTotal: placed }],
            blocked: quantity > placed ? [{ laneKey: "choke", quantity: quantity - placed, foreignShare: 0 }] : [],
          };
        }
        return { placements: [{ quantity, edges: [`${from}->${to}`], perUnit: 1, fuelTotal: quantity }], blocked: [] };
      },
    };

    const result = matchFactionTransfers([severe, d1, mild, d2], booker);
    const severeTransfers = result.transfers.filter((t) => t.toSystemId === "Severe");
    const mildTransfers = result.transfers.filter((t) => t.toSystemId === "Mild");
    expect(severeTransfers).toHaveLength(1);
    expect(severeTransfers[0].quantity).toBe(4);
    expect(mildTransfers).toHaveLength(1);
    expect(mildTransfers[0].quantity).toBe(5);
    expect(result.budgetSkipped).toBe(1);
  });

  it("counts budgetSkipped for exactly the deficits an unaffordable draw ended, not deficits with no donor at all", () => {
    // Severe and Second both hit an unaffordable draw against their own donor (skip each); Sourceless
    // has no donor anywhere for its good, which is a structural `unservable` case, not a skip.
    const severe = sys("Severe", 0, { goodId: "ore", stock: 0, logisticsTarget: 100, demand: 5 });
    const d1 = sys("D1", 5, { goodId: "ore", stock: 200, logisticsTarget: 10, demand: 5 });
    const second = sys("Second", 0, { goodId: "ore", stock: 0, logisticsTarget: 100, demand: 4 });
    const d2 = sys("D2", 5, { goodId: "ore", stock: 200, logisticsTarget: 10, demand: 5 });
    const sourceless = sys("Sourceless", 0, { goodId: "water", stock: 0, logisticsTarget: 50, demand: 5 });

    const booker = costBooker((from, to) => {
      if (from === "D1" && to === "Severe") return 1;
      if (from === "D2" && to === "Second") return 1;
      return null;
    });

    const result = matchFactionTransfers([severe, d1, second, d2, sourceless], booker);
    expect(result.budgetSkipped).toBe(2);
    expect(result.unservable.some((u) => u.systemId === "Sourceless")).toBe(true);
  });

  it("does not treat a congestion-blocked haul as unservable — the booker's blocked volume is its own signal", () => {
    // D1 structurally holds 100 drawable — comfortably more than B's 50-unit shortfall — but the
    // booker can only physically place 10 of any draw (a saturated lane). `unservable` reads priced
    // reachability and live donor stock, never what the booker managed to move, so this deficit must
    // not be reported unservable despite ending up mostly unfed. (The other emission site — no donor
    // anywhere for the good — is untouched by this fixture and stays covered by the sourceless case
    // above.)
    const d1 = sys("D1", 1000, { goodId: "food", stock: 150, logisticsTarget: 50, demand: 5 });
    const b = sys("B", 0, { goodId: "food", stock: 0, logisticsTarget: 50, demand: 5 });
    const congested = makeBooker({ price: () => 1, place: (_from, _to, quantity) => Math.min(quantity, 10) });

    const result = matchFactionTransfers([d1, b], congested);
    expect(result.transfers).toHaveLength(1);
    expect(result.transfers[0].quantity).toBe(10);
    expect(result.unservable).toEqual([]);
    expect(result.fundingBound).toEqual([]);
  });

  it("does not treat a saturated (price-null) donor as unservable when it is still structurally reachable", () => {
    // D1 holds ample drawable (100) but its only path to B is currently saturated — `price` returns
    // null (congestion), exactly as a real booker's `priceFrom` would for a lane at capacity — while
    // `reachable` reports true (the path exists, only saturation closes it). The reachable
    // drawable reads `reachableFrom`, not `priceFrom`, so this deficit's 50-unit want is structurally
    // closeable and must not be reported unservable, even though nothing can actually ship this run.
    const d1 = sys("D1", 100, { goodId: "food", stock: 150, logisticsTarget: 50, demand: 5 });
    const b = sys("B", 0, { goodId: "food", stock: 0, logisticsTarget: 50, demand: 5 });
    const saturated = makeBooker({ price: () => null, reachable: () => true });

    const result = matchFactionTransfers([d1, b], saturated);
    expect(result.transfers).toEqual([]); // nothing priced, so nothing ships this run
    expect(result.unservable).toEqual([]);
  });

  it("still treats a politically-closed donor (unreachable, not merely saturated) as unservable", () => {
    // Same shape as above, but `reachable` also reports false — a donor traversability genuinely
    // excludes, not one congestion has merely priced out for this run. This deficit's want must
    // still read unservable: the reachable drawable is 0, exactly the pre-existing "no donor at all"
    // reading.
    const d1 = sys("D1", 100, { goodId: "food", stock: 150, logisticsTarget: 50, demand: 5 });
    const b = sys("B", 0, { goodId: "food", stock: 0, logisticsTarget: 50, demand: 5 });
    const closed = makeBooker({ price: () => null, reachable: () => false });

    const result = matchFactionTransfers([d1, b], closed);
    expect(result.transfers).toEqual([]);
    expect(result.unservable).toEqual([{ goodId: "food", systemId: "B", shortfall: 50 }]);
  });
});

describe("matchFactionTransfers — budget floors at 0 rather than going negative on a live-price overshoot", () => {
  it("does not starve a cheap deficit behind a donor whose live billing overshot its frozen quote", () => {
    // D1's drawable is sized to exactly 10 (stock 10, donorReserve 0) — the SAME shape the "affordable
    // === wanted" regression test below uses, deliberately, so `affordable(10) < wanted(10)` reads
    // FALSE here too and cannot by itself explain a stop. Severe's fill draws from D1 at a FROZEN quote
    // of 2/unit (`priceFrom`), sized against the budget (20) to `affordable = 10` — exactly D1's whole
    // drawable, so `wanted === affordable` and the pre-existing `affordable < wanted` check alone would
    // NOT catch this draw. The booker's `routeAndBook` instead bills the whole draw at a LIVE 3/unit (as
    // a real congestion-priced placement can, once earlier placements in the same draw raise the price)
    // — 10 × 3 = 30, overshooting the 20 budget by 10. Only the overshoot detection (`budget < 0` before
    // flooring) can catch this and stop Severe's fill; without it `stoppedDonorId` never gets set for
    // Severe at all (the for-of loop simply exhausts its one candidate), so `budgetSkipped` undercounts
    // by exactly one. Without the floor besides, `budget` stays at -10 and every later `affordable`
    // computes to 0 regardless (`budget > 0 ? … : 0`) — the same reading a floored 0 produces — so
    // Cheap's own transfer is unaffected either way; what the floor's absence actually breaks is
    // Severe's own classification, which this test pins directly.
    const severe = sys("Severe", 0, { goodId: "food", stock: 0, logisticsTarget: 1000, demand: 5 });
    const d1 = sys("D1", 20, { goodId: "food", stock: 10, logisticsTarget: 0, donorReserve: 0, demand: 0 });
    const cheap = sys("Cheap", 0, { goodId: "food", stock: 0, logisticsTarget: 5, demand: 1 });
    const d2 = sys("D2", 0, { goodId: "food", stock: 1000, logisticsTarget: 10, demand: 5 });

    const overshootBooker: RouteBookerFor = {
      priceFrom: (sinkId) => (donorId) => {
        if (sinkId === "Severe" && donorId === "D1") return 2; // frozen quote: 20 budget / 2 = 10 affordable
        if (sinkId === "Cheap" && donorId === "D2") return 1;
        return null;
      },
      reachableFrom: (sinkId) => (donorId) =>
        (sinkId === "Severe" && donorId === "D1") || (sinkId === "Cheap" && donorId === "D2"),
      routeAndBook: (from, to, quantity) => {
        if (from === "D1" && to === "Severe") {
          // Bills the WHOLE requested quantity at a live price above the frozen quote.
          return { placements: [{ quantity, edges: ["choke"], perUnit: 3, fuelTotal: quantity }], blocked: [] };
        }
        return { placements: [{ quantity, edges: [`${from}->${to}`], perUnit: 1, fuelTotal: quantity }], blocked: [] };
      },
    };

    const result = matchFactionTransfers([severe, d1, cheap, d2], overshootBooker);
    const severeTransfers = result.transfers.filter((t) => t.toSystemId === "Severe");
    const cheapTransfers = result.transfers.filter((t) => t.toSystemId === "Cheap");
    expect(severeTransfers).toHaveLength(1);
    expect(severeTransfers[0]).toMatchObject({ fromSystemId: "D1", quantity: 10, cost: 30 });
    // The overshoot billed 30 against a 20 budget — floored at 0, never negative.
    expect(cheapTransfers).toHaveLength(0);
    // Both deficits register as budget-stopped — Severe by its own overshoot, Cheap by the floored-
    // to-0 budget it inherited. Neither is silently dropped with no accounting.
    expect(result.budgetSkipped).toBe(2);
  });

  it("still does not blame a donor whose affordable share exactly matched what it owed (no overshoot)", () => {
    // Regression pin: the floor must only trigger on a genuine overshoot (budget goes negative), not
    // merely on hitting 0 exactly. D1's stock-limited share of the deficit (10, at a live price equal
    // to its frozen quote) exactly exhausts the budget — no overshoot — so D1 must not be the donor
    // the skip names.
    const d1 = sys("D1", 10, { goodId: "food", stock: 10, logisticsTarget: 0, donorReserve: 0, demand: 0 });
    const d2 = sys("D2", 0, { goodId: "food", stock: 20, logisticsTarget: 0, donorReserve: 0, demand: 0 });
    const deficit = sys("B", 0, { goodId: "food", stock: 0, logisticsTarget: 25, demand: 5 });
    const costByDonor = (from: string) => (from === "D1" ? 1 : 2);

    const result = matchFactionTransfers([d1, d2, deficit], costBooker(costByDonor));
    expect(result.transfers).toMatchObject([
      { goodId: "food", fromSystemId: "D1", toSystemId: "B", quantity: 10, cost: 10 },
    ]);
    expect(result.fundingBound).toEqual([{ goodId: "food", fromSystemId: "D2", toSystemId: "B" }]);
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
    expect(result.transfers).toMatchObject([
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
    expect(result.transfers).toMatchObject([
      { goodId: "food", fromSystemId: "D1", toSystemId: "B", quantity: 10, cost: 10 },
    ]);
    expect(result.fundingBound).toEqual([{ goodId: "food", fromSystemId: "D1", toSystemId: "B" }]);
    expect(result.unservable).toEqual([{ goodId: "food", systemId: "B", shortfall: 160 }]);
  });

  it("spreads the residual reading over every world a drained pool left short, and stays silent where the donors still hold stock", () => {
    // Water: one donor holding 100, two deficits wanting 100 each. Both are at 0 cycles of cover, so
    // the level splits the donor evenly, each draws 50 and the pool is spent. Read at the END of the
    // good's pass, both worlds see donors holding nothing and each carries the 50 no capacity in the
    // faction can close — the levels summing to exactly the 100 the faction lacks. A reading taken at
    // each world's own draw turn instead puts the whole gap on whichever world the cover order
    // reached last, because the earlier ones looked at a pool that was still full.
    //
    // Luxuries: L1 is left just as short, but by a saturated lane — the booker places 10 of its
    // 50-unit raise — while its donor still holds 90. Capacity is not what is keeping it short, so
    // it reads nothing here; the booker's blocked volume is where that loss is recorded.
    const donorWater = sys("Dwater", 1000, { goodId: "water", stock: 150, logisticsTarget: 50, demand: 5 });
    const w1 = sys("W1", 0, { goodId: "water", stock: 0, logisticsTarget: 100, demand: 5 });
    const w2 = sys("W2", 0, { goodId: "water", stock: 0, logisticsTarget: 100, demand: 5 });
    const donorLux = sys("Dlux", 0, { goodId: "luxuries", stock: 150, logisticsTarget: 50, demand: 5 });
    const l1 = sys("L1", 0, { goodId: "luxuries", stock: 0, logisticsTarget: 50, demand: 5 });
    const congestedLux = makeBooker({
      price: () => 1,
      place: (from, _to, quantity) => (from === "Dlux" ? Math.min(quantity, 10) : quantity),
    });

    const result = matchFactionTransfers([donorWater, w1, w2, donorLux, l1], congestedLux);

    expect(result.transfers).toMatchObject([
      { goodId: "water", fromSystemId: "Dwater", toSystemId: "W1", quantity: 50, cost: 50 },
      { goodId: "water", fromSystemId: "Dwater", toSystemId: "W2", quantity: 50, cost: 50 },
      { goodId: "luxuries", fromSystemId: "Dlux", toSystemId: "L1", quantity: 10, cost: 10 },
    ]);
    expect(result.fundingBound).toEqual([]);
    // Every world the drained pool left short, not just the last one drawn.
    expect(result.unservable).toEqual([
      { goodId: "water", systemId: "W1", shortfall: 50 },
      { goodId: "water", systemId: "W2", shortfall: 50 },
    ]);
    // The levels sum to the faction's own gap in the good: 100 of want still standing against a
    // reachable drawable of 0.
    const water = result.unservable.filter((u) => u.goodId === "water");
    expect(water.reduce((sum, u) => sum + u.shortfall, 0)).toBeCloseTo(100, 8);
  });

  it("levels three deficits sharing one donor to a common cover instead of filling the first to its target", () => {
    // Three deficits of one good sharing one donor holding 100 against 140 of want. All three are
    // empty, so all three are drawn, and the level lands at 9 cycles: D1 and D2 both end there
    // (45 units each at 5/cycle) and D3, whose own 10-unit target is only 2 cycles, stops at its
    // target. Filling the queue's head to its full target instead would put 80 into D1, 20 into D2
    // and nothing into D3.
    //
    // The donor ends dry, so the two worlds still short of their targets carry the residue between
    // them: D1 is 35 short of its 80 and D2 5 short of its 50, summing to the 40 of want the
    // faction's supply of the good could not cover. D3 reached its own target and reads nothing.
    // Budget is ample throughout (generation 1000 against 100 units at 1 hop).
    const donor = sys("A", 1000, { goodId: "food", stock: 150, logisticsTarget: 50, demand: 5 });
    const d1 = sys("D1", 0, { goodId: "food", stock: 0, logisticsTarget: 80, demand: 5 });
    const d2 = sys("D2", 0, { goodId: "food", stock: 0, logisticsTarget: 50, demand: 5 });
    const d3 = sys("D3", 0, { goodId: "food", stock: 0, logisticsTarget: 10, demand: 5 });

    const result = matchFactionTransfers([donor, d1, d2, d3], oneHop);

    expect(result.transfers).toMatchObject([
      { goodId: "food", fromSystemId: "A", toSystemId: "D1", quantity: 45 },
      { goodId: "food", fromSystemId: "A", toSystemId: "D2", quantity: 45 },
      { goodId: "food", fromSystemId: "A", toSystemId: "D3", quantity: 10 },
    ]);
    // The donor is drawn to exactly what it had, and no further.
    const moved = result.transfers.reduce((sum, t) => sum + t.quantity, 0);
    expect(moved).toBeCloseTo(100, 8);
    expect(result.fundingBound).toEqual([]);
    expect(result.unservable).toHaveLength(2);
    expect(result.unservable[0].systemId).toBe("D1");
    expect(result.unservable[0].shortfall).toBeCloseTo(35, 8);
    expect(result.unservable[1].systemId).toBe("D2");
    expect(result.unservable[1].shortfall).toBeCloseTo(5, 8);
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

  it("keeps suppressed and realised-zero former exporters on the ordinary excess path", () => {
    const recipient = sys("B", 0, { goodId: "ore", stock: 0, logisticsTarget: 100, demand: 5 });
    const suppressed = sys("A", 100, {
      goodId: "ore", stock: 150, logisticsTarget: 100, demand: 5,
      production: 30, capacityProduction: 30, productionSuppressed: true,
    });
    const realisedZero = sys("C", 100, {
      goodId: "ore", stock: 150, logisticsTarget: 100, demand: 5,
      production: 0, capacityProduction: 30,
    });

    const suppressedTransfer = matchFactionTransfers([suppressed, recipient], oneHop).transfers[0];
    const realisedZeroTransfer = matchFactionTransfers([realisedZero, recipient], oneHop).transfers[0];
    expect(suppressedTransfer.quantity).toBe(50);
    expect(realisedZeroTransfer.quantity).toBe(50);
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

describe("countedStock / orderCover / levelCover", () => {
  it("counts physical stock alone under the ration-line proxy even with a haul in flight", () => {
    // demand 10 → ration line 20 (RATION_COVER 2 × demand). stock 15 < 20, so inbound is ignored.
    const g: GoodMarketState = {
      goodId: "ore", stock: 15, logisticsTarget: 400, donorReserve: 400, demand: 10,
      drawDemand: 10, civilianDemand: 10, production: 0, capacityProduction: 0,
      scheduledInbound: 50,
    };
    expect(countedStock(g)).toBe(15);
  });

  it("counts stock plus inbound once stock is at or above the ration line", () => {
    // demand 10 → ration line 20. stock 25 ≥ 20, so inbound counts.
    const g: GoodMarketState = {
      goodId: "ore", stock: 25, logisticsTarget: 400, donorReserve: 400, demand: 10,
      drawDemand: 10, civilianDemand: 10, production: 0, capacityProduction: 0,
      scheduledInbound: 50,
    };
    expect(countedStock(g)).toBe(75);
  });

  it("counts inbound at the boundary itself — the exception is strict-below, not at-or-below", () => {
    // stock exactly at the ration line (20) must land on the "counts inbound" side.
    const g: GoodMarketState = {
      goodId: "ore", stock: 20, logisticsTarget: 400, donorReserve: 400, demand: 10,
      drawDemand: 10, civilianDemand: 10, production: 0, capacityProduction: 0,
      scheduledInbound: 50,
    };
    expect(countedStock(g)).toBe(70);
  });

  it("orderCover reads +Infinity at drawDemand 0, and Infinity sorts after every finite cover ascending", () => {
    const g: GoodMarketState = {
      goodId: "ore", stock: 100, logisticsTarget: 400, donorReserve: 400, demand: 10,
      drawDemand: 0, civilianDemand: 10, production: 0, capacityProduction: 0,
    };
    expect(orderCover(g)).toBe(Infinity);

    const covers = [orderCover(g), 3, 1, 7].sort((a, b) => a - b);
    expect(covers[covers.length - 1]).toBe(Infinity);
    for (const c of covers) expect(Number.isNaN(c)).toBe(false);
  });

  it("a braked factory reads a higher orderCover than an unbraked market at the same stock and use, but the same levelCover", () => {
    const unbraked: GoodMarketState = {
      goodId: "ore", stock: 100, logisticsTarget: 400, donorReserve: 400, demand: 10,
      drawDemand: 10, civilianDemand: 10, production: 0, capacityProduction: 0,
    };
    const braked: GoodMarketState = { ...unbraked, drawDemand: 5 };
    expect(orderCover(braked)).toBeGreaterThan(orderCover(unbraked));
    expect(levelCover(braked)).toBe(levelCover(unbraked));
  });
});
