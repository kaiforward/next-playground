/**
 * Emergent-civ expansion — the pure claim + develop engine (control/develop tiers of the three-state
 * ownership model). Scores in-reach unclaimed systems, proposes each faction's best claim(s), resolves
 * cross-faction conflicts deterministically, and plans developments of a faction's own controlled
 * systems. Zero I/O; the reach/candidate data is supplied by providers built in the tick body.
 */
import type { RNG } from "@/lib/engine/universe-gen";
import { RESOURCE_TYPES } from "@/lib/engine/resources";

/** One in-reach unclaimed system a faction could claim, with its score inputs. */
export interface ClaimCandidate {
  systemId: string;
  /** Fewest jumps from any of the faction's owned systems (≥ 1 — the candidate is unclaimed). */
  minHops: number;
  peopleLand: number;
  /** Count of resources this system has any deposit slot for. */
  resourceDiversity: number;
}

/** A faction's desire to claim `systemId` this cycle, with its comparable score. */
export interface ClaimProposal {
  factionId: string;
  systemId: string;
  score: number;
}

/** The winning claim for a target system after cross-faction resolution. */
export interface ResolvedClaim {
  systemId: string;
  factionId: string;
}

export interface ExpansionScoreWeights {
  habitable: number;
  diversity: number;
  /** Proximity discount strength; feeds 1 / (1 + proximity × minHops). */
  proximity: number;
}

export interface ExpansionParams {
  maxClaimsPerCycle: number;
  scoreFloor: number;
  weights: ExpansionScoreWeights;
  /** Galaxy-wide max system `peopleLand` this tick (a floor-1 ratio, never a raw 0) — normalises the
   * habitable substrate term to [0,1], the same ratio `placeHomeworlds` (`lib/engine/faction-gen.ts`)
   * takes against its own per-galaxy max, so a giant system's raw scale alone can never dominate the
   * score. Threaded in from the claim-candidate assembly in `lib/world/tick.ts`. */
  peopleLandMax: number;
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/**
 * Absolute claim desirability: weighted NORMALISED substrate × a distance discount. Comparable
 * across factions. Both substrate terms are clamped to [0,1] before weighting — `peopleLand` against
 * `peopleLandMax` (the galaxy-wide max this tick), `resourceDiversity` against
 * `RESOURCE_TYPES.length` — the same normalisation `placeHomeworlds` applies to its own substrate
 * terms. Normalising (not just shrinking the weights) is what actually bounds each term: a raw-scale
 * weight can be tuned arbitrarily small and a large-enough system still swamps it, but a term already
 * clamped to [0,1] cannot exceed its weight no matter how big the system is.
 */
export function scoreClaimCandidate(
  c: ClaimCandidate,
  w: ExpansionScoreWeights,
  peopleLandMax: number,
): number {
  const habitableTerm = clamp01(Math.max(0, c.peopleLand) / Math.max(1, peopleLandMax));
  const diversityTerm = clamp01(Math.max(0, c.resourceDiversity) / RESOURCE_TYPES.length);
  const substrate = w.habitable * habitableTerm + w.diversity * diversityTerm;
  const proximity = 1 / (1 + w.proximity * Math.max(0, c.minHops));
  return substrate * proximity;
}

/**
 * A faction's claim proposals for this cycle: its highest-scoring in-reach candidates above the floor,
 * capped at `maxClaimsPerCycle`. Ranked by score descending, systemId ascending — a total order, so
 * the result is independent of candidate input order.
 */
export function proposeFactionClaims(
  factionId: string,
  candidates: ClaimCandidate[],
  params: ExpansionParams,
): ClaimProposal[] {
  return candidates
    .map((c) => ({
      factionId,
      systemId: c.systemId,
      score: scoreClaimCandidate(c, params.weights, params.peopleLandMax),
    }))
    .filter((p) => p.score >= params.scoreFloor)
    .sort((a, b) => b.score - a.score || a.systemId.localeCompare(b.systemId))
    .slice(0, Math.max(0, params.maxClaimsPerCycle));
}

/** Score-equality tolerance for the tie-break — floats from the scorer never compare exactly. */
const SCORE_EPS = 1e-9;

/**
 * Two-phase claim resolution: group proposals by target, award each target to its highest-scoring
 * proposer, break exact ties with a single seeded RNG draw over the (sorted) tied factions. Targets
 * are iterated in sorted systemId order and tied factions in sorted id order BEFORE any draw, so the
 * RNG draw sequence — and thus the outcome — depends only on the world and seed, never on proposal or
 * Map iteration order. Returns one ResolvedClaim per distinct target.
 */
export function resolveClaims(proposals: ClaimProposal[], rng: RNG): ResolvedClaim[] {
  const byTarget = new Map<string, ClaimProposal[]>();
  for (const p of proposals) {
    const list = byTarget.get(p.systemId);
    if (list) list.push(p);
    else byTarget.set(p.systemId, [p]);
  }
  const entries = [...byTarget.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const resolved: ResolvedClaim[] = [];
  for (const [systemId, contenders] of entries) {
    let maxScore = -Infinity;
    for (const c of contenders) if (c.score > maxScore) maxScore = c.score;
    const tied = contenders
      .filter((c) => maxScore - c.score <= SCORE_EPS)
      .sort((a, b) => a.factionId.localeCompare(b.factionId));
    const winner = tied.length === 1 ? tied[0] : tied[Math.floor(rng() * tied.length)];
    resolved.push({ systemId, factionId: winner.factionId });
  }
  return resolved;
}
