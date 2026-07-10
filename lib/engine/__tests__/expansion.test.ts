import { describe, it, expect } from "vitest";
import {
  scoreClaimCandidate,
  proposeFactionClaims,
  resolveClaims,
  type ClaimCandidate,
  type ClaimProposal,
  type ExpansionParams,
} from "@/lib/engine/expansion";
import { mulberry32 } from "@/lib/engine/universe-gen";

const WEIGHTS = { habitable: 1.0, diversity: 3.0, trait: 2.0, proximity: 0.5 };
const PARAMS: ExpansionParams = { maxClaimsPerPulse: 1, scoreFloor: 0.001, weights: WEIGHTS };

function cand(p: Partial<ClaimCandidate> & { systemId: string }): ClaimCandidate {
  return { minHops: 1, habitableSpace: 0, resourceDiversity: 0, traitQuality: 0, ...p };
}

describe("scoreClaimCandidate", () => {
  it("rewards substrate and discounts distance", () => {
    const near = cand({ systemId: "a", habitableSpace: 100, minHops: 1 });
    const far = cand({ systemId: "b", habitableSpace: 100, minHops: 3 });
    expect(scoreClaimCandidate(near, WEIGHTS)).toBeGreaterThan(scoreClaimCandidate(far, WEIGHTS));
  });
  it("scores a zero-substrate candidate at 0", () => {
    expect(scoreClaimCandidate(cand({ systemId: "z" }), WEIGHTS)).toBe(0);
  });
});

describe("proposeFactionClaims", () => {
  it("proposes the highest-scoring in-reach candidate, capped at maxClaimsPerPulse", () => {
    const candidates = [
      cand({ systemId: "poor", habitableSpace: 5 }),
      cand({ systemId: "rich", habitableSpace: 200, resourceDiversity: 5 }),
    ];
    const out = proposeFactionClaims("f1", candidates, PARAMS);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ factionId: "f1", systemId: "rich" });
    expect(out[0].score).toBeGreaterThan(0);
  });
  it("proposes nothing when every candidate is below the floor", () => {
    expect(proposeFactionClaims("f1", [cand({ systemId: "dead" })], PARAMS)).toEqual([]);
  });
  it("is deterministic and ranks by (score, systemId) — independent of input order", () => {
    const a = cand({ systemId: "a", habitableSpace: 100 });
    const b = cand({ systemId: "b", habitableSpace: 100 });
    const forward = proposeFactionClaims("f1", [a, b], { ...PARAMS, maxClaimsPerPulse: 2 });
    const reverse = proposeFactionClaims("f1", [b, a], { ...PARAMS, maxClaimsPerPulse: 2 });
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
