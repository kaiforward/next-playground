import { describe, it, expect } from "vitest";
import {
  calculateReward,
  selectEconomyCandidates,
  selectEventCandidates,
  validateAccept,
  validateDelivery,
  type MarketSnapshot,
  type EventSnapshot,
} from "../missions";
import { MISSION_CONSTANTS } from "@/lib/constants/missions";

// ── Helpers ─────────────────────────────────────────────────────

/** Deterministic RNG that always returns the given value. */
const fixedRng = (value: number) => () => value;

/** Build a simple hop distance map for testing. */
function makeHopDistances(
  entries: [string, string, number][],
): Map<string, Map<string, number>> {
  const result = new Map<string, Map<string, number>>();
  for (const [from, to, hops] of entries) {
    if (!result.has(from)) result.set(from, new Map());
    result.get(from)!.set(to, hops);
    // Also add self-distance
    result.get(from)!.set(from, 0);
    // Add reverse
    if (!result.has(to)) result.set(to, new Map());
    result.get(to)!.set(from, hops);
    result.get(to)!.set(to, 0);
  }
  return result;
}

const goodTiers: Record<string, number> = {
  food: 0,
  ore: 0,
  fuel: 1,
  medicine: 1,
  electronics: 2,
  weapons: 2,
  luxuries: 2,
  machinery: 2,
};

// ── calculateReward ─────────────────────────────────────────────

describe("calculateReward", () => {
  it("scales with quantity", () => {
    const r20 = calculateReward(20, 1, 0, false);
    const r40 = calculateReward(40, 1, 0, false);
    expect(r40).toBeGreaterThan(r20);
  });

  it("scales with distance (hops)", () => {
    const r1 = calculateReward(30, 1, 0, false);
    const r3 = calculateReward(30, 3, 0, false);
    expect(r3).toBeGreaterThan(r1);
    // 1.25^3 / 1.25^1 = 1.5625x
    expect(r3 / r1).toBeCloseTo(1.25 * 1.25, 1);
  });

  it("scales with tier", () => {
    const tier0 = calculateReward(30, 1, 0, false);
    const tier1 = calculateReward(30, 1, 1, false);
    const tier2 = calculateReward(30, 1, 2, false);
    expect(tier1).toBeGreaterThan(tier0);
    expect(tier2).toBeGreaterThan(tier1);
    expect(tier1 / tier0).toBeCloseTo(4.0, 0);
    expect(tier2 / tier0).toBeCloseTo(12.0, 0);
  });

  it("applies event bonus", () => {
    const base = calculateReward(30, 1, 0, false);
    const event = calculateReward(30, 1, 0, true);
    expect(event / base).toBeCloseTo(1.5, 1);
  });

  it("enforces minimum reward", () => {
    const reward = calculateReward(1, 0, 0, false);
    expect(reward).toBe(MISSION_CONSTANTS.REWARD_MIN);
  });

  it("returns integer values", () => {
    const reward = calculateReward(33, 2, 1, true);
    expect(reward).toBe(Math.floor(reward));
  });
});

// ── selectEconomyCandidates ─────────────────────────────────────

describe("selectEconomyCandidates", () => {
  const hopDist = makeHopDistances([
    ["sys-a", "sys-b", 1],
    ["sys-a", "sys-c", 2],
    ["sys-b", "sys-c", 1],
  ]);

  it("generates import mission for high-price market", () => {
    const markets: MarketSnapshot[] = [
      { systemId: "sys-a", goodId: "food", currentPrice: 100, basePrice: 30 }, // ratio 3.33
    ];

    // rng returns 0.0 to pass probability check, then 0.5 for quantity
    let callCount = 0;
    const rng = () => {
      callCount++;
      return callCount === 1 ? 0.0 : 0.5;
    };

    const candidates = selectEconomyCandidates(markets, hopDist, goodTiers, 100, rng);
    expect(candidates).toHaveLength(1);

    const c = candidates[0];
    expect(c.systemId).toBe("sys-a");
    expect(c.destinationId).toBe("sys-a"); // Import: same system
    expect(c.goodId).toBe("food");
    expect(c.eventId).toBeNull();
    expect(c.deadlineTick).toBe(100 + MISSION_CONSTANTS.DEADLINE_TICKS);
  });

  it("generates export mission for low-price market", () => {
    const markets: MarketSnapshot[] = [
      { systemId: "sys-a", goodId: "food", currentPrice: 10, basePrice: 30 }, // ratio 0.33
    ];

    // rng: 0.0 (prob), 0.0 (dest pick), 0.5 (quantity)
    let callCount = 0;
    const rng = () => {
      callCount++;
      if (callCount === 1) return 0.0; // pass probability
      if (callCount === 2) return 0.0; // pick first destination
      return 0.5; // quantity
    };

    const candidates = selectEconomyCandidates(markets, hopDist, goodTiers, 100, rng);
    expect(candidates).toHaveLength(1);

    const c = candidates[0];
    expect(c.systemId).toBe("sys-a");
    expect(c.destinationId).not.toBe("sys-a"); // Export: different system
    expect(c.goodId).toBe("food");
  });

  it("skips markets that don't pass probability roll", () => {
    const markets: MarketSnapshot[] = [
      { systemId: "sys-a", goodId: "food", currentPrice: 100, basePrice: 30 },
    ];

    // rng returns 1.0 → fails probability check (> 0.08)
    const candidates = selectEconomyCandidates(markets, hopDist, goodTiers, 100, fixedRng(1.0));
    expect(candidates).toHaveLength(0);
  });

  it("skips markets in normal price range", () => {
    const markets: MarketSnapshot[] = [
      { systemId: "sys-a", goodId: "food", currentPrice: 30, basePrice: 30 }, // ratio 1.0
    ];

    const candidates = selectEconomyCandidates(markets, hopDist, goodTiers, 100, fixedRng(0.0));
    expect(candidates).toHaveLength(0);
  });
});

// ── selectEventCandidates ───────────────────────────────────────

describe("selectEventCandidates", () => {
  const hopDist = makeHopDistances([["sys-a", "sys-b", 1]]);
  const missionGoods = {
    war: { goods: ["weapons", "fuel", "machinery"], isImport: true },
    plague: { goods: ["medicine", "food"], isImport: true },
  };

  it("generates missions for war event", () => {
    const events: EventSnapshot[] = [
      { id: "evt-1", type: "war", systemId: "sys-a" },
    ];

    // rng: 0.5 → count = 1+floor(0.5*3) = 2, then quantities
    let callCount = 0;
    const rng = () => {
      callCount++;
      return 0.5;
    };

    const candidates = selectEventCandidates(events, missionGoods, hopDist, goodTiers, 100, rng);
    expect(candidates.length).toBeGreaterThanOrEqual(1);
    expect(candidates.length).toBeLessThanOrEqual(3);

    for (const c of candidates) {
      expect(c.systemId).toBe("sys-a");
      expect(c.destinationId).toBe("sys-a"); // Import
      expect(c.eventId).toBe("evt-1");
      expect(missionGoods.war.goods).toContain(c.goodId);
    }
  });

  it("generates missions for plague event", () => {
    const events: EventSnapshot[] = [
      { id: "evt-2", type: "plague", systemId: "sys-b" },
    ];

    const candidates = selectEventCandidates(events, missionGoods, hopDist, goodTiers, 100, fixedRng(0.5));
    expect(candidates.length).toBeGreaterThanOrEqual(1);

    for (const c of candidates) {
      expect(c.eventId).toBe("evt-2");
      expect(["medicine", "food"]).toContain(c.goodId);
    }
  });

  it("skips events without mission goods mapping", () => {
    const events: EventSnapshot[] = [
      { id: "evt-3", type: "ore_glut", systemId: "sys-a" },
    ];

    const candidates = selectEventCandidates(events, missionGoods, hopDist, goodTiers, 100, fixedRng(0.5));
    expect(candidates).toHaveLength(0);
  });

  it("sets eventId for cascade expiry", () => {
    const events: EventSnapshot[] = [
      { id: "evt-4", type: "war", systemId: "sys-a" },
    ];

    const candidates = selectEventCandidates(events, missionGoods, hopDist, goodTiers, 100, fixedRng(0.0));
    for (const c of candidates) {
      expect(c.eventId).toBe("evt-4");
    }
  });
});

// ── validateAccept ──────────────────────────────────────────────

describe("validateAccept", () => {
  it("succeeds with valid inputs", () => {
    const result = validateAccept(null, ["sys-a", "sys-b"], "sys-a", 3);
    expect(result.ok).toBe(true);
  });

  it("rejects already-claimed mission", () => {
    const result = validateAccept("player-1", ["sys-a"], "sys-a", 3);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("already accepted");
  });

  it("rejects when player has no ship docked at station", () => {
    const result = validateAccept(null, ["sys-b"], "sys-a", 3);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("docked");
  });

  it("rejects when at mission cap", () => {
    const result = validateAccept(null, ["sys-a"], "sys-a", MISSION_CONSTANTS.MAX_ACTIVE_PER_PLAYER);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("more than");
  });
});

// ── validateDelivery ────────────────────────────────────────────

describe("validateDelivery", () => {
  it("succeeds with valid inputs", () => {
    const result = validateDelivery("player-1", "player-1", "sys-b", "sys-b", 50, 30, 500, 400);
    expect(result.ok).toBe(true);
  });

  it("rejects when mission belongs to different player", () => {
    const result = validateDelivery("player-2", "player-1", "sys-b", "sys-b", 50, 30, 500, 400);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("does not belong");
  });

  it("rejects when ship is not at destination", () => {
    const result = validateDelivery("player-1", "player-1", "sys-a", "sys-b", 50, 30, 500, 400);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("destination");
  });

  it("rejects when cargo is insufficient", () => {
    const result = validateDelivery("player-1", "player-1", "sys-b", "sys-b", 20, 30, 500, 400);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Insufficient cargo");
  });

  it("rejects when mission has expired", () => {
    const result = validateDelivery("player-1", "player-1", "sys-b", "sys-b", 50, 30, 400, 500);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("expired");
  });
});
