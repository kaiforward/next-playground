/**
 * Emergent-civ expansion tuning — the control (claim) and develop tiers of the three-state
 * ownership model. Each monthly pulse a faction claims one in-reach unclaimed system as
 * `controlled`, then may develop one of its controlled systems to `developed` (seeding a small
 * conserved colony population). Magnitudes are a coarse first-cut (simulator-validated for coherent
 * growth, not tuned — later phases move the calibration target). Scores are ABSOLUTE (not
 * pool-normalized) so two factions' proposals for the same system compare directly in resolution.
 *
 * Claims are cheap and near-instant this phase (bounded by MAX_CLAIMS_PER_PULSE + the reach radius +
 * the score floor). Developing a controlled system is NO longer instant or capped here — it is a
 * pool-funded, timed colony-establish project (docs/planned/economy-colonisation-cost.md); COLONY_SEED_POP
 * and DEVELOP_HABITABLE_FLOOR feed that project's sizing/eligibility, the construction pool paces it.
 */
export const EXPANSION = {
  /** Unclaimed systems within this many jumps of a faction's territory (any owned tier) are claim
   * candidates — leapfrog allowed, bounded for performance. Must be ≤ the tick's hop-BFS radius. */
  REACH_JUMPS: 3,
  /** Systems a faction claims per monthly pulse — small, so the map fills gradually. */
  MAX_CLAIMS_PER_PULSE: 1,
  /** Minimum claim score; below it a candidate isn't worth claiming. Permissive — excludes only
   * zero-substrate systems. */
  SCORE_FLOOR: 0.001,
  /** Weights over the (absolute) substrate terms and the proximity discount. `proximity` feeds
   * 1 / (1 + proximity × minHops), so nearer candidates outscore equal-substrate distant ones. */
  SCORE_WEIGHTS: { habitable: 1.0, diversity: 3.0, trait: 2.0, proximity: 0.5 },
  /** A controlled system is only worth developing if it can host housing — skip dead rocks. */
  DEVELOP_HABITABLE_FLOOR: 1,
  /** Starter population a new colony receives, transferred (conserved) from the nearest developed
   * same-faction system so logistic growth can begin from a non-zero base. */
  COLONY_SEED_POP: 50,
} as const;
