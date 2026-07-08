/**
 * Emergent-civ expansion — the pure claim + develop engine (control/develop tiers of the three-state
 * ownership model). Scores in-reach unclaimed systems, proposes each faction's best claim(s), resolves
 * cross-faction conflicts deterministically, and plans developments of a faction's own controlled
 * systems. Zero I/O; the reach/candidate data is supplied by providers built in the tick body.
 */

/** One in-reach unclaimed system a faction could claim, with its score inputs. */
export interface ClaimCandidate {
  systemId: string;
  /** Fewest jumps from any of the faction's owned systems (≥ 1 — the candidate is unclaimed). */
  minHops: number;
  habitableSpace: number;
  /** Count of resources this system has any deposit slot for. */
  resourceDiversity: number;
  /** Σ of the system's trait qualities. */
  traitQuality: number;
}

/** A faction's desire to claim `systemId` this pulse, with its comparable score. */
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
  trait: number;
  /** Proximity discount strength; feeds 1 / (1 + proximity × minHops). */
  proximity: number;
}

export interface ExpansionParams {
  maxClaimsPerPulse: number;
  scoreFloor: number;
  weights: ExpansionScoreWeights;
}

/** Absolute claim desirability: weighted substrate × a distance discount. Comparable across factions. */
export function scoreClaimCandidate(c: ClaimCandidate, w: ExpansionScoreWeights): number {
  const substrate =
    w.habitable * Math.max(0, c.habitableSpace) +
    w.diversity * Math.max(0, c.resourceDiversity) +
    w.trait * Math.max(0, c.traitQuality);
  const proximity = 1 / (1 + w.proximity * Math.max(0, c.minHops));
  return substrate * proximity;
}

/**
 * A faction's claim proposals for this pulse: its highest-scoring in-reach candidates above the floor,
 * capped at `maxClaimsPerPulse`. Ranked by score descending, systemId ascending — a total order, so
 * the result is independent of candidate input order.
 */
export function proposeFactionClaims(
  factionId: string,
  candidates: ClaimCandidate[],
  params: ExpansionParams,
): ClaimProposal[] {
  return candidates
    .map((c) => ({ factionId, systemId: c.systemId, score: scoreClaimCandidate(c, params.weights) }))
    .filter((p) => p.score >= params.scoreFloor)
    .sort((a, b) => b.score - a.score || a.systemId.localeCompare(b.systemId))
    .slice(0, Math.max(0, params.maxClaimsPerPulse));
}
