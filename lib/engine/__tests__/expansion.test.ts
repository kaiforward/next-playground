import { describe, it, expect } from "vitest";
import {
  scoreClaimCandidate,
  proposeFactionClaims,
  resolveClaims,
  type ClaimCandidate,
  type ClaimProposal,
  type ExpansionParams,
} from "@/lib/engine/expansion";
import { mulberry32, generateUniverse } from "@/lib/engine/universe-gen";
import { RESOURCE_TYPES } from "@/lib/engine/resources";
import { EXPANSION } from "@/lib/constants/expansion";
import { genConfigForSystemCount, DEFAULT_SYSTEM_COUNT, REGION_NAMES } from "@/lib/constants/universe-gen";
import { buildGenParams } from "@/lib/world/gen";

const WEIGHTS = { habitable: 1.0, diversity: 3.0, proximity: 0.5 };
const PEOPLE_LAND_MAX = 1000;
const PARAMS: ExpansionParams = {
  maxClaimsPerCycle: 1, scoreFloor: 0.001, weights: WEIGHTS, peopleLandMax: PEOPLE_LAND_MAX,
};

function cand(p: Partial<ClaimCandidate> & { systemId: string }): ClaimCandidate {
  return { minHops: 1, peopleLand: 0, resourceDiversity: 0, ...p };
}

describe("scoreClaimCandidate", () => {
  it("rewards substrate and discounts distance", () => {
    const near = cand({ systemId: "a", peopleLand: 100, minHops: 1 });
    const far = cand({ systemId: "b", peopleLand: 100, minHops: 3 });
    expect(scoreClaimCandidate(near, WEIGHTS, PEOPLE_LAND_MAX))
      .toBeGreaterThan(scoreClaimCandidate(far, WEIGHTS, PEOPLE_LAND_MAX));
  });
  it("scores a zero-substrate candidate at 0", () => {
    expect(scoreClaimCandidate(cand({ systemId: "z" }), WEIGHTS, PEOPLE_LAND_MAX)).toBe(0);
  });
  it("scores claims on substrate × proximity with no trait term", () => {
    const w = { habitable: 1, diversity: 1, proximity: 0.1 };
    const near = { systemId: "a", minHops: 1, peopleLand: 100, resourceDiversity: 3 };
    const far = { systemId: "b", minHops: 4, peopleLand: 100, resourceDiversity: 3 };
    expect(scoreClaimCandidate(near, w, PEOPLE_LAND_MAX)).toBeGreaterThan(scoreClaimCandidate(far, w, PEOPLE_LAND_MAX)); // proximity discount
    // identical substrate + hops ⇒ identical score (nothing trait-derived left)
    expect(scoreClaimCandidate({ ...near, systemId: "c" }, w, PEOPLE_LAND_MAX))
      .toBeCloseTo(scoreClaimCandidate(near, w, PEOPLE_LAND_MAX), 9);
  });

  // ── Prove 1: both substrate terms are normalised to [0,1] for ANY candidate ──────────────
  it("clamps the habitable term at 1 regardless of how far peopleLand exceeds the galaxy max — a giant system cannot dominate by raw scale", () => {
    const w = { habitable: 1, diversity: 0, proximity: 0 };
    const atMax = cand({ systemId: "at-max", peopleLand: PEOPLE_LAND_MAX, minHops: 0 });
    const huge = cand({ systemId: "huge", peopleLand: PEOPLE_LAND_MAX * 100, minHops: 0 });
    const enormous = cand({ systemId: "enormous", peopleLand: PEOPLE_LAND_MAX * 1_000_000, minHops: 0 });
    const scoreAtMax = scoreClaimCandidate(atMax, w, PEOPLE_LAND_MAX);
    const scoreHuge = scoreClaimCandidate(huge, w, PEOPLE_LAND_MAX);
    const scoreEnormous = scoreClaimCandidate(enormous, w, PEOPLE_LAND_MAX);
    // A weights-only pseudo-fix (raw peopleLand × a smaller weight) would still scale linearly and
    // never saturate — this asserts the term literally caps at the habitable weight itself, i.e. the
    // normalised term saturates at exactly 1, not merely "grows more slowly".
    expect(scoreAtMax).toBeCloseTo(w.habitable, 9);
    expect(scoreHuge).toBeCloseTo(w.habitable, 9);
    expect(scoreEnormous).toBeCloseTo(w.habitable, 9);
  });

  it("clamps the diversity term at 1 regardless of resourceDiversity exceeding RESOURCE_TYPES.length", () => {
    const w = { habitable: 0, diversity: 1, proximity: 0 };
    const atMax = cand({ systemId: "at-max", resourceDiversity: RESOURCE_TYPES.length, minHops: 0 });
    const overCounted = cand({ systemId: "over", resourceDiversity: RESOURCE_TYPES.length * 50, minHops: 0 });
    expect(scoreClaimCandidate(atMax, w, PEOPLE_LAND_MAX)).toBeCloseTo(w.diversity, 9);
    expect(scoreClaimCandidate(overCounted, w, PEOPLE_LAND_MAX)).toBeCloseTo(w.diversity, 9);
  });

  it("bounds the pre-proximity substrate sum at habitable + diversity weights for any candidate", () => {
    const w = { habitable: 1, diversity: 3, proximity: 0 }; // proximity 0 → discount is 1, substrate reads directly
    const extreme = cand({
      systemId: "extreme", minHops: 0,
      peopleLand: PEOPLE_LAND_MAX * 1e9, resourceDiversity: RESOURCE_TYPES.length * 1e9,
    });
    expect(scoreClaimCandidate(extreme, w, PEOPLE_LAND_MAX)).toBeCloseTo(w.habitable + w.diversity, 9);
  });

  // ── Prove 2: SCORE_FLOOR (0) no longer excludes a zero-substrate candidate — it clears the floor
  // like anything else and simply ranks last, on the new adjacency-only reach ──
  describe("EXPANSION.SCORE_FLOOR on the normalised scale", () => {
    it("clears the floor for an exactly-zero-substrate candidate — barren is claimable, just last in line", () => {
      const zero = cand({ systemId: "dead" });
      const score = scoreClaimCandidate(zero, EXPANSION.SCORE_WEIGHTS, PEOPLE_LAND_MAX);
      expect(score).toBe(0);
      expect(score).toBeGreaterThanOrEqual(EXPANSION.SCORE_FLOOR);
    });
    it("clears the floor for the smallest realistic single-resource-type candidate, even at max reach", () => {
      // One present resource type, no habitable land, at the worst (furthest) in-reach hop count.
      const barelyDiverse = cand({
        systemId: "corridor", peopleLand: 0, resourceDiversity: 1, minHops: EXPANSION.REACH_JUMPS,
      });
      const score = scoreClaimCandidate(barelyDiverse, EXPANSION.SCORE_WEIGHTS, PEOPLE_LAND_MAX);
      expect(score).toBeGreaterThanOrEqual(EXPANSION.SCORE_FLOOR);
    });
    it("clears the floor for the smallest archetype-table peopleLand alone, even at max reach", () => {
      // The smallest positive peopleLand a habitable body archetype can produce (lib/constants/bodies.ts,
      // tundra dark land min=100), scored against a galaxy max in the low thousands, at worst reach.
      const barelyHabitable = cand({
        systemId: "tiny-world", peopleLand: 100, resourceDiversity: 0, minHops: EXPANSION.REACH_JUMPS,
      });
      const score = scoreClaimCandidate(barelyHabitable, EXPANSION.SCORE_WEIGHTS, 2000);
      expect(score).toBeGreaterThanOrEqual(EXPANSION.SCORE_FLOOR);
    });
  });

  // ── Prove 3: among equal-distance candidates, more peopleLand still outranks (no term dropped) ──
  it("ranks more peopleLand higher among candidates with identical diversity and distance", () => {
    const w = EXPANSION.SCORE_WEIGHTS;
    const less = cand({ systemId: "less", peopleLand: 100, resourceDiversity: 4, minHops: 2 });
    const more = cand({ systemId: "more", peopleLand: 900, resourceDiversity: 4, minHops: 2 });
    expect(scoreClaimCandidate(more, w, PEOPLE_LAND_MAX))
      .toBeGreaterThan(scoreClaimCandidate(less, w, PEOPLE_LAND_MAX));
  });

  // ── Prove 4: the diversity term still discriminates at realistic generated body counts ──────
  it("the diversity term discriminates (isn't saturated identical) across a real generated galaxy", () => {
    function realDiversity(depositCounts: Record<string, number>): number {
      let n = 0;
      for (const r of RESOURCE_TYPES) if (depositCounts[r] > 0) n++;
      return n;
    }
    const config = genConfigForSystemCount(DEFAULT_SYSTEM_COUNT);
    const params = buildGenParams(config.SEED, config);
    const u = generateUniverse(params, REGION_NAMES);
    const diversities = u.systems.map((s) => realDiversity(s.depositCounts));
    const distinctValues = new Set(diversities);
    // Not every system reads the same diversity term (saturation) and not every system is 0.
    expect(distinctValues.size).toBeGreaterThan(1);
    const maxTerm = Math.max(...diversities) / RESOURCE_TYPES.length;
    const minTerm = Math.min(...diversities) / RESOURCE_TYPES.length;
    expect(maxTerm).toBeGreaterThan(minTerm);
    // Fewer than every system reads the fully-saturated max diversity term — the term still ranks
    // most of the galaxy rather than collapsing most candidates to the same top score.
    const saturatedShare = diversities.filter((d) => d === RESOURCE_TYPES.length).length / diversities.length;
    expect(saturatedShare).toBeLessThan(0.9);
  });
});

describe("proposeFactionClaims", () => {
  it("proposes the highest-scoring in-reach candidate, capped at maxClaimsPerCycle", () => {
    const candidates = [
      cand({ systemId: "poor", peopleLand: 5 }),
      cand({ systemId: "rich", peopleLand: 200, resourceDiversity: 5 }),
    ];
    const out = proposeFactionClaims("f1", candidates, PARAMS);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ factionId: "f1", systemId: "rich" });
    expect(out[0].score).toBeGreaterThan(0);
  });
  it("proposes nothing when every candidate is below the floor", () => {
    expect(proposeFactionClaims("f1", [cand({ systemId: "dead" })], PARAMS)).toEqual([]);
  });
  it("still proposes a zero-habitable-space system — the develop-tier floor does not gate claims", () => {
    // A dead system (no people land at all) scores 0 on the habitable term but can still clear
    // SCORE_FLOOR on diversity/proximity alone: claims stay territory-and-corridor, unlike the
    // develop tier's colonisability floor (colony-eligibility.ts), which this candidate would fail.
    const dead = cand({ systemId: "dead-but-claimable", peopleLand: 0, resourceDiversity: 5 });
    const out = proposeFactionClaims("f1", [dead], PARAMS);
    expect(out).toHaveLength(1);
    expect(out[0].systemId).toBe("dead-but-claimable");
  });
  it("claims a fully zero-substrate candidate under the real EXPANSION floor — barren is claimable, last in line", () => {
    // EXPANSION.SCORE_FLOOR is 0 (not this file's own stricter PARAMS.scoreFloor), so a candidate with
    // no habitable land AND no resource deposit — score exactly 0 — still clears it and gets proposed
    // when it is the faction's only in-reach option, exactly as the develop-tier floor never gated it.
    const barren = cand({ systemId: "barren" });
    const out = proposeFactionClaims("f1", [barren], { ...PARAMS, scoreFloor: EXPANSION.SCORE_FLOOR });
    expect(out).toEqual([{ factionId: "f1", systemId: "barren", score: 0 }]);
  });
  it("ranks a barren adjacent system after a substantive one in the same call", () => {
    const barren = cand({ systemId: "a-barren" });
    const rich = cand({ systemId: "z-rich", peopleLand: 100, resourceDiversity: 3 });
    const out = proposeFactionClaims("f1", [barren, rich], {
      ...PARAMS, scoreFloor: EXPANSION.SCORE_FLOOR, maxClaimsPerCycle: 2,
    });
    expect(out.map((p) => p.systemId)).toEqual(["z-rich", "a-barren"]);
  });
  it("is deterministic and ranks by (score, systemId) — independent of input order", () => {
    const a = cand({ systemId: "a", peopleLand: 100 });
    const b = cand({ systemId: "b", peopleLand: 100 });
    const forward = proposeFactionClaims("f1", [a, b], { ...PARAMS, maxClaimsPerCycle: 2 });
    const reverse = proposeFactionClaims("f1", [b, a], { ...PARAMS, maxClaimsPerCycle: 2 });
    expect(forward.map((p) => p.systemId)).toEqual(["a", "b"]);
    expect(reverse.map((p) => p.systemId)).toEqual(["a", "b"]);
  });
});

describe("resolveClaims", () => {
  it("gives an uncontested target to its sole proposer", () => {
    expect(resolveClaims([{ factionId: "f1", systemId: "s1", score: 5 }], mulberry32(1)))
      .toEqual([{ systemId: "s1", factionId: "f1" }]);
  });
  it("awards a contested target to the highest score (not proposal order)", () => {
    const proposals: ClaimProposal[] = [
      { factionId: "f1", systemId: "s1", score: 3 },
      { factionId: "f2", systemId: "s1", score: 9 },
    ];
    expect(resolveClaims(proposals, mulberry32(1))).toEqual([{ systemId: "s1", factionId: "f2" }]);
    expect(resolveClaims([...proposals].reverse(), mulberry32(1))).toEqual([{ systemId: "s1", factionId: "f2" }]);
  });
  it("resolves each distinct target independently", () => {
    const proposals: ClaimProposal[] = [
      { factionId: "f1", systemId: "s1", score: 5 },
      { factionId: "f2", systemId: "s2", score: 5 },
    ];
    const out = resolveClaims(proposals, mulberry32(1)).sort((a, b) => a.systemId.localeCompare(b.systemId));
    expect(out).toEqual([{ systemId: "s1", factionId: "f1" }, { systemId: "s2", factionId: "f2" }]);
  });
  it("breaks exact ties deterministically with the seeded RNG, independent of proposal order", () => {
    const tied: ClaimProposal[] = [
      { factionId: "f1", systemId: "s1", score: 5 },
      { factionId: "f2", systemId: "s1", score: 5 },
    ];
    const winA = resolveClaims(tied, mulberry32(42))[0].factionId;
    const winB = resolveClaims([...tied].reverse(), mulberry32(42))[0].factionId;
    expect(winA).toBe(winB);
    expect(["f1", "f2"]).toContain(winA);
  });
});
