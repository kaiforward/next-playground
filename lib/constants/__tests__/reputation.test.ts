import { describe, it, expect } from "vitest";
import {
  REPUTATION_TIERS,
  getReputationTier,
  getReputationMultipliers,
} from "../reputation";
import { GOVERNMENT_TYPES } from "../government";
import { getSpread } from "../market-economy";
import { ALL_REPUTATION_STANDINGS } from "@/lib/types/guards";

describe("REPUTATION_TIERS", () => {
  it("partitions the score range [-100, +100] without gaps", () => {
    const sorted = [...REPUTATION_TIERS].sort((a, b) => a.minScore - b.minScore);
    expect(sorted[0].minScore).toBe(-100);
    expect(sorted[sorted.length - 1].maxScore).toBe(100);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].minScore).toBe(sorted[i - 1].maxScore + 1);
    }
  });

  it("defines a tier for every ReputationStanding", () => {
    for (const standing of ALL_REPUTATION_STANDINGS) {
      const tier = REPUTATION_TIERS.find((t) => t.standing === standing);
      expect(tier, `tier for "${standing}" should exist`).toBeDefined();
    }
  });

  it("marks only hostile as trade-denied", () => {
    for (const tier of REPUTATION_TIERS) {
      expect(tier.tradeDenied).toBe(tier.standing === "hostile");
    }
  });

  // The favourable (buyMult < 1) multipliers must never let an instant
  // same-market buy→resell profit, even at the tightest government spread:
  // (1+minSpread)·buyMult ≥ (1−minSpread)·sellMult. This is the anti-arbitrage
  // invariant — a regression that widens the perk past the spread reopens the
  // resell exploit. (Replaces an earlier cosmetic "multipliers are symmetric"
  // check; perks are bounded by the spread, penalties intentionally aren't.)
  it("favourable multipliers stay inside the tightest bid-ask spread (no instant-resell profit)", () => {
    const minSpread = Math.min(
      ...Object.values(GOVERNMENT_TYPES).map((g) => getSpread(g)),
    );
    for (const tier of REPUTATION_TIERS) {
      if (tier.tradeDenied || tier.buyMultiplier >= 1) continue; // perks only
      expect(
        (1 + minSpread) * tier.buyMultiplier,
        `${tier.standing} perk must not invert the round-trip at the tightest spread`,
      ).toBeGreaterThanOrEqual((1 - minSpread) * tier.sellMultiplier);
    }
  });
});

describe("getReputationTier — boundary values", () => {
  const cases: ReadonlyArray<[number, string]> = [
    [100, "champion"],
    [75, "champion"],
    [74, "trusted"],
    [25, "trusted"],
    [24, "neutral"],
    [0, "neutral"],
    [-24, "neutral"],
    [-25, "distrusted"],
    [-74, "distrusted"],
    [-75, "hostile"],
    [-100, "hostile"],
  ];

  for (const [score, expected] of cases) {
    it(`score ${score} → ${expected}`, () => {
      expect(getReputationTier(score).standing).toBe(expected);
    });
  }

  it("clamps scores above +100", () => {
    expect(getReputationTier(999).standing).toBe("champion");
  });

  it("clamps scores below -100", () => {
    expect(getReputationTier(-999).standing).toBe("hostile");
  });

  // The score column is `Float`, so values like 24.25 or -74.5 fall between
  // integer tier boundaries. Earlier the [minScore, maxScore] range match
  // threw for these; now they resolve to whichever tier's minScore is at
  // or below the score.
  describe("half-integer scores resolve to the lower-min tier", () => {
    const halfCases: ReadonlyArray<[number, string]> = [
      [74.999, "trusted"],
      [25.5, "trusted"],
      [24.999, "neutral"],
      [24.25, "neutral"],
      [-24.5, "distrusted"],
      [-74.5, "hostile"],
    ];
    for (const [score, expected] of halfCases) {
      it(`score ${score} → ${expected}`, () => {
        expect(getReputationTier(score).standing).toBe(expected);
      });
    }
  });
});

describe("getReputationMultipliers", () => {
  it("returns 1.0/1.0 for neutral", () => {
    expect(getReputationMultipliers("neutral")).toEqual({ buy: 1.0, sell: 1.0 });
  });

  it("champion: discount on buy, premium on sell (bounded under the spread)", () => {
    expect(getReputationMultipliers("champion")).toEqual({ buy: 0.98, sell: 1.02 });
  });

  it("trusted: smaller discount on buy, smaller premium on sell", () => {
    expect(getReputationMultipliers("trusted")).toEqual({ buy: 0.99, sell: 1.01 });
  });

  it("distrusted: premium on buy, discount on sell", () => {
    expect(getReputationMultipliers("distrusted")).toEqual({ buy: 1.08, sell: 0.92 });
  });

  // Hostile multipliers are 1.0/1.0 by design: trade is denied before the
  // multiplier applies, so the values are deliberately inert. Asserted explicitly
  // so a regression to "punishing" hostile multipliers is caught.
  it("hostile: inert 1.0/1.0 (tradeDenied gates this tier before multipliers apply)", () => {
    expect(getReputationMultipliers("hostile")).toEqual({ buy: 1.0, sell: 1.0 });
  });
});
