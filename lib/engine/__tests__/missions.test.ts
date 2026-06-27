import { describe, it, expect } from "vitest";
import {
  calculateReward,
  selectEventCandidates,
  validateAccept,
  validateDelivery,
  type MissionEventSnapshot,
} from "../missions";
import { MISSION_CONSTANTS } from "@/lib/constants/missions";

// ── Helpers ─────────────────────────────────────────────────────

/** Deterministic RNG that always returns the given value. */
const fixedRng = (value: number) => () => value;

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

// ── selectEventCandidates ───────────────────────────────────────

describe("selectEventCandidates", () => {
  const missionGoods = {
    inner_system_conflict: { goods: ["weapons", "fuel", "machinery"], isImport: true },
    plague: { goods: ["medicine", "food"], isImport: true },
  };

  it("generates missions for inner_system_conflict event", () => {
    const events: MissionEventSnapshot[] = [
      { id: "evt-1", type: "inner_system_conflict", systemId: "sys-a" },
    ];

    // rng: 0.5 → count = 1+floor(0.5*3) = 2, then quantities
    let callCount = 0;
    const rng = () => {
      callCount++;
      return 0.5;
    };

    const candidates = selectEventCandidates(events, missionGoods, goodTiers, 100, rng);
    expect(candidates.length).toBeGreaterThanOrEqual(1);
    expect(candidates.length).toBeLessThanOrEqual(3);

    for (const c of candidates) {
      expect(c.systemId).toBe("sys-a");
      expect(c.destinationId).toBe("sys-a"); // Import
      expect(c.eventId).toBe("evt-1");
      expect(missionGoods.inner_system_conflict.goods).toContain(c.goodId);
    }
  });

  it("generates missions for plague event", () => {
    const events: MissionEventSnapshot[] = [
      { id: "evt-2", type: "plague", systemId: "sys-b" },
    ];

    const candidates = selectEventCandidates(events, missionGoods, goodTiers, 100, fixedRng(0.5));
    expect(candidates.length).toBeGreaterThanOrEqual(1);

    for (const c of candidates) {
      expect(c.eventId).toBe("evt-2");
      expect(["medicine", "food"]).toContain(c.goodId);
    }
  });

  it("skips events without mission goods mapping", () => {
    const events: MissionEventSnapshot[] = [
      { id: "evt-3", type: "ore_glut", systemId: "sys-a" },
    ];

    const candidates = selectEventCandidates(events, missionGoods, goodTiers, 100, fixedRng(0.5));
    expect(candidates).toHaveLength(0);
  });

  it("sets eventId for cascade expiry", () => {
    const events: MissionEventSnapshot[] = [
      { id: "evt-4", type: "inner_system_conflict", systemId: "sys-a" },
    ];

    const candidates = selectEventCandidates(events, missionGoods, goodTiers, 100, fixedRng(0.0));
    for (const c of candidates) {
      expect(c.eventId).toBe("evt-4");
    }
  });
});

// ── validateAccept ──────────────────────────────────────────────

describe("validateAccept", () => {
  it("succeeds with valid inputs", () => {
    const result = validateAccept(null, 3);
    expect(result.ok).toBe(true);
  });

  it("rejects already-claimed mission", () => {
    const result = validateAccept("player-1", 3);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("already accepted");
  });

  it("rejects when at mission cap", () => {
    const result = validateAccept(null, MISSION_CONSTANTS.MAX_ACTIVE_PER_PLAYER);
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
