import { describe, it, expect } from "vitest";
import {
  allianceDissolvedTemplate,
  applyDriftToPair,
  borderConflictTemplate,
  computeConflictCounts,
  computeRelationDrift,
  detectTierTransition,
  indexAlliances,
  indexPairs,
  indexRelationEvents,
  pactNegotiationTemplate,
  parseRelationEventMetadata,
  rollWindow,
} from "../relations";
import {
  ALLIANCE,
  DRIFT_COEFFICIENTS,
  RELATION_HISTORY_MAX,
  RELATIONS_PHASE_SENTINEL,
} from "@/lib/constants/relations";
import type {
  AlliancePactView,
  FactionPairView,
  FactionView,
  RelationEventView,
} from "@/lib/tick/world/relations-world";
import { pairKey } from "@/lib/tick/world/relations-world";

// ── Fixtures ────────────────────────────────────────────────────

function fac(
  id: string,
  overrides: Partial<FactionView> = {},
): FactionView {
  return {
    id,
    name: id.toUpperCase(),
    governmentType: "federation",
    doctrine: "mercantile",
    territorySize: 50,
    status: "major",
    ...overrides,
  };
}

function pair(
  aId: string,
  bId: string,
  score = 0,
): FactionPairView {
  const [factionAId, factionBId] = aId < bId ? [aId, bId] : [bId, aId];
  return {
    factionAId,
    factionBId,
    score,
    history: [],
    updatedAtTick: 0,
  };
}

// ── computeRelationDrift ────────────────────────────────────────

describe("computeRelationDrift", () => {
  // Default doctrines chosen to give zero doctrine-compatibility delta
  // (mercantile + opportunistic), so each test isolates the driver it changes.
  const base = () => ({
    pair: pair("a", "b", 0),
    factionA: fac("a", { doctrine: "mercantile" }),
    factionB: fac("b", { doctrine: "opportunistic" }),
    borderCount: 0,
    tradeVolume: 0,
    hasAlliance: false,
    commonEnemyCount: 0,
    allianceWithEnemyCount: 0,
  });

  it("applies the baseline downward bias even when nothing else is in play", () => {
    const result = computeRelationDrift(base());
    expect(result.delta).toBe(DRIFT_COEFFICIENTS.baselineBias);
    expect(result.drivers).toContain("baseline");
  });

  it("adds border friction proportional to shared border count", () => {
    const result = computeRelationDrift({ ...base(), borderCount: 4 });
    const expected =
      DRIFT_COEFFICIENTS.baselineBias +
      DRIFT_COEFFICIENTS.perBorderFriction * 4;
    expect(result.delta).toBeCloseTo(expected, 6);
    expect(result.drivers).toContain("border");
  });

  it("applies alliance maintenance drift positively", () => {
    const result = computeRelationDrift({ ...base(), hasAlliance: true });
    const expected =
      DRIFT_COEFFICIENTS.baselineBias + DRIFT_COEFFICIENTS.alliancePresent;
    expect(result.delta).toBeCloseTo(expected, 6);
    expect(result.drivers).toContain("alliance");
  });

  it("caps the trade volume bonus", () => {
    const result = computeRelationDrift({ ...base(), tradeVolume: 1_000_000 });
    // baseline + capped trade bonus only
    const expected =
      DRIFT_COEFFICIENTS.baselineBias + DRIFT_COEFFICIENTS.maxTradeBonus;
    expect(result.delta).toBeCloseTo(expected, 6);
    expect(result.drivers).toContain("trade");
  });

  it("uses doctrine compatibility table for non-matching doctrines", () => {
    // expansionist vs protectionist = -0.06
    const result = computeRelationDrift({
      ...base(),
      factionA: fac("a", { doctrine: "expansionist" }),
      factionB: fac("b", { doctrine: "protectionist" }),
    });
    const expected = DRIFT_COEFFICIENTS.baselineBias + -0.06;
    expect(result.delta).toBeCloseTo(expected, 6);
    expect(result.drivers).toContain("doctrine");
  });

  it("includes government opposition delta (federation vs authoritarian)", () => {
    const result = computeRelationDrift({
      ...base(),
      factionA: fac("a", { governmentType: "federation", doctrine: "mercantile" }),
      factionB: fac("b", { governmentType: "authoritarian", doctrine: "opportunistic" }),
    });
    expect(result.drivers).toContain("gov-opp");
    // baseline (-0.05) + government opposition (-0.04) = -0.09
    expect(result.delta).toBeCloseTo(DRIFT_COEFFICIENTS.baselineBias + -0.04, 6);
  });

  it("sums multiple drivers", () => {
    const result = computeRelationDrift({
      ...base(),
      borderCount: 2,
      tradeVolume: 500,
      hasAlliance: true,
      commonEnemyCount: 1,
    });
    const expected =
      DRIFT_COEFFICIENTS.baselineBias +
      DRIFT_COEFFICIENTS.perBorderFriction * 2 +
      DRIFT_COEFFICIENTS.alliancePresent +
      DRIFT_COEFFICIENTS.perCommonEnemy +
      Math.min(DRIFT_COEFFICIENTS.perTradeUnit * 500, DRIFT_COEFFICIENTS.maxTradeBonus);
    expect(result.delta).toBeCloseTo(expected, 6);
  });
});

// ── applyDriftToPair ────────────────────────────────────────────

describe("applyDriftToPair", () => {
  it("clamps the resulting score to [-100, +100]", () => {
    const p = pair("a", "b", 99);
    const result = applyDriftToPair(p, { delta: 10, drivers: "" }, 1);
    expect(result.newScore).toBe(100);
  });

  it("clamps negative overflow as well", () => {
    const p = pair("a", "b", -98);
    const result = applyDriftToPair(p, { delta: -10, drivers: "" }, 1);
    expect(result.newScore).toBe(-100);
  });

  it("trims history to the ring buffer max", () => {
    const seedHistory = Array.from({ length: RELATION_HISTORY_MAX }, (_, i) => ({
      tick: i,
      delta: 0.1,
      drivers: `entry-${i}`,
    }));
    const p: FactionPairView = { ...pair("a", "b", 0), history: seedHistory };
    const result = applyDriftToPair(p, { delta: 0.5, drivers: "new" }, 999);
    expect(result.newHistory.length).toBe(RELATION_HISTORY_MAX);
    expect(result.newHistory[result.newHistory.length - 1].drivers).toBe("new");
    // Oldest entry should be dropped.
    expect(result.newHistory[0].drivers).toBe("entry-1");
  });
});

// ── detectTierTransition ────────────────────────────────────────

describe("detectTierTransition", () => {
  it("returns null when score stays within the same tier", () => {
    const p = pair("a", "b", 30); // friendly
    const result = detectTierTransition(p, 40);
    expect(result).toBeNull();
  });

  it("detects friendly → allied crossing", () => {
    const p = pair("a", "b", 70); // friendly
    const result = detectTierTransition(p, 80); // allied
    expect(result).not.toBeNull();
    expect(result?.oldTier).toBe("friendly");
    expect(result?.newTier).toBe("allied");
  });

  it("detects neutral → unfriendly crossing (border conflict trigger)", () => {
    const p = pair("a", "b", -20);
    const result = detectTierTransition(p, -30);
    expect(result?.oldTier).toBe("neutral");
    expect(result?.newTier).toBe("unfriendly");
  });
});

// ── computeConflictCounts ────────────────────────────────────────

describe("computeConflictCounts", () => {
  it("counts third parties hostile to both A and B as common enemies", () => {
    const pairs = [
      pair("a", "x", -50), // A hostile to X
      pair("b", "x", -60), // B hostile to X
      pair("a", "y", 10), // A neutral to Y
      pair("b", "y", -50), // B hostile to Y — not common, A isn't hostile
    ];
    const result = computeConflictCounts(
      "a",
      "b",
      ["a", "b", "x", "y"],
      indexPairs(pairs),
      new Map(),
    );
    expect(result.commonEnemyCount).toBe(1);
  });

  it("counts ally-of-enemy entanglements (A allied to X, B hostile to X)", () => {
    const pairs = [
      pair("b", "x", -50), // B hostile to X
    ];
    const alliances: AlliancePactView[] = [
      { factionAId: "a", factionBId: "x", formedAtTick: 0, pendingDissolutionAtTick: null },
    ];
    const result = computeConflictCounts(
      "a",
      "b",
      ["a", "b", "x"],
      indexPairs(pairs),
      indexAlliances(alliances),
    );
    expect(result.allianceWithEnemyCount).toBe(1);
  });
});

// ── Event templates ─────────────────────────────────────────────

describe("event templates", () => {
  const seededRng = () => 0.5;

  it("border conflict template carries factionA/B in metadata and a sentinel expiresAtTick", () => {
    const t = borderConflictTemplate("fa", "fb", "sys1", "reg1", seededRng);
    expect(t.type).toBe("border_conflict");
    expect(t.metadata.factionAId).toBe("fa");
    expect(t.metadata.factionBId).toBe("fb");
    expect(t.metadata.expiresAtTick).toBe(RELATIONS_PHASE_SENTINEL);
    expect(t.phase).toBe("tension");
    expect(t.systemId).toBe("sys1");
  });

  it("pact negotiation template sets expiresAtTick from window and uses sentinel phaseDuration", () => {
    const tick = 100;
    const t = pactNegotiationTemplate("fa", "fb", tick, seededRng);
    expect(t.type).toBe("pact_under_negotiation");
    expect(t.phaseDuration).toBe(RELATIONS_PHASE_SENTINEL);
    const [min, max] = ALLIANCE.negotiationWindow;
    expect(t.metadata.expiresAtTick).toBeGreaterThanOrEqual(tick + min);
    expect(t.metadata.expiresAtTick).toBeLessThanOrEqual(tick + max);
  });

  it("alliance dissolved template uses the fixed dissolutionWindow and sentinel phaseDuration", () => {
    const tick = 200;
    const t = allianceDissolvedTemplate("fa", "fb", tick);
    expect(t.type).toBe("alliance_dissolved");
    expect(t.phase).toBe("dissolving");
    expect(t.systemId).toBeNull();
    expect(t.regionId).toBeNull();
    expect(t.phaseDuration).toBe(RELATIONS_PHASE_SENTINEL);
    expect(t.metadata.factionAId).toBe("fa");
    expect(t.metadata.factionBId).toBe("fb");
    expect(t.metadata.expiresAtTick).toBe(tick + ALLIANCE.dissolutionWindow);
  });
});

// ── rollWindow ──────────────────────────────────────────────────

describe("rollWindow", () => {
  it("returns min when rng yields 0", () => {
    expect(rollWindow([5, 10], () => 0)).toBe(5);
  });

  it("returns max when rng yields the largest float < 1", () => {
    expect(rollWindow([5, 10], () => 0.9999)).toBe(10);
  });

  it("returns a value in range for arbitrary rng outputs", () => {
    for (const r of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      const v = rollWindow([3, 7], () => r);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it("collapses to a single value when min === max", () => {
    expect(rollWindow([4, 4], () => 0.42)).toBe(4);
  });
});

// ── parseRelationEventMetadata ──────────────────────────────────

describe("parseRelationEventMetadata", () => {
  it("accepts valid shape", () => {
    const parsed = parseRelationEventMetadata({
      factionAId: "a",
      factionBId: "b",
      expiresAtTick: 50,
    });
    expect(parsed).toEqual({ factionAId: "a", factionBId: "b", expiresAtTick: 50 });
  });

  it("rejects malformed input", () => {
    expect(parseRelationEventMetadata(null)).toBeNull();
    expect(parseRelationEventMetadata({})).toBeNull();
    expect(
      parseRelationEventMetadata({ factionAId: "a", factionBId: 1, expiresAtTick: 5 }),
    ).toBeNull();
  });
});

// ── indexRelationEvents (canonical pair key) ────────────────────

describe("indexRelationEvents", () => {
  it("keys events by type and canonical pairKey regardless of metadata order", () => {
    const e1: RelationEventView = {
      id: "e1",
      type: "border_conflict",
      phaseStartTick: 0,
      phaseDuration: 10,
      metadata: { factionAId: "b", factionBId: "a", expiresAtTick: 999 },
    };
    const map = indexRelationEvents([e1]);
    // Lookup should work via canonical (a,b) order too.
    const found = map.get(`border_conflict|${pairKey("a", "b")}`);
    expect(found).toBeDefined();
  });
});
