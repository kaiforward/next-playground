/**
 * Emergent-civ expansion tuning — the control (claim) and develop tiers of the three-state
 * ownership model. Each cycle start a faction claims one in-reach unclaimed system as
 * `controlled`, then may develop one of its controlled systems to `developed` (seeding a small
 * conserved colony population). Magnitudes are a coarse first-cut (simulator-validated for coherent
 * growth, not tuned — later phases move the calibration target). Scores are ABSOLUTE (not
 * pool-normalised) so two factions' proposals for the same system compare directly in resolution.
 *
 * Claims are cheap and near-instant this phase (bounded by MAX_CLAIMS_PER_CYCLE + the reach radius +
 * the score floor). Developing a controlled system is NO longer instant or capped here — it is a
 * pool-funded, timed colony-establish project (docs/active/gameplay/colonisation.md); COLONY_SEED_POP
 * feeds that project's sizing, the construction pool paces it. The colonisability floor itself is not
 * an authored constant — a controlled system is developable once it holds one whole housing level of
 * people land (`effectiveSpaceCost(HOUSING_TYPE)`, `lib/constants/industry.ts`), so the floor tracks
 * housing's own cost rather than drifting from it.
 */
export const EXPANSION = {
  /** Unclaimed systems within this many jumps of a faction's territory (any owned tier) are claim
   * candidates — leapfrog allowed, bounded for performance. Must be ≤ the tick's hop-BFS radius. */
  REACH_JUMPS: 3,
  /** Systems a faction claims per cycle start — small, so the map fills gradually. */
  MAX_CLAIMS_PER_CYCLE: 1,
  /** Minimum claim score; below it a candidate isn't worth claiming. Permissive — excludes only
   * zero-substrate systems. Scored on NORMALISED [0,1] substrate terms (`scoreClaimCandidate`), so
   * the smallest achievable nonzero score is bounded well above float noise: one present resource
   * type alone (diversity 1/`RESOURCE_TYPES.length` × its 3.0 weight ≈ 0.43) or the smallest
   * archetype-table `peopleLand` alone (~100 of a galaxy max in the thousands, × its 1.0 weight
   * ≈ 0.05), each still discounted by proximity at the worst in-reach case
   * (`REACH_JUMPS` × `proximity` weight ⇒ ×0.4) — both comfortably above 1e-4. Set two orders of
   * magnitude below that floor so it functions as a pure zero/nonzero gate, robust to future
   * archetype-table retunes, rather than a near-miss threshold. */
  SCORE_FLOOR: 0.0001,
  /** Weights over the NORMALISED [0,1] substrate terms (`peopleLand` ÷ galaxy max, diversity ÷
   * `RESOURCE_TYPES.length` — `scoreClaimCandidate`) and the proximity discount. `proximity` feeds
   * 1 / (1 + proximity × minHops), so nearer candidates outscore equal-substrate distant ones.
   * `diversity` outweighing `habitable` 3:1 is the authored intent from before normalisation — on
   * the old absolute scale a system's raw `peopleLand` (often in the hundreds-to-thousands) swamped
   * diversity's raw 0-7 regardless of this ratio, so the weight never actually took effect. On the
   * normalised scale it does: claims deliberately favour resource-diverse territory (corridor/access
   * value) over raw habitable land, since habitability itself is what the develop tier's own floor
   * and `colonyValue` (colonisation-value.ts) gate on — claims stay "territory-and-corridor" per the
   * module docstring above, not a habitability pre-filter. */
  SCORE_WEIGHTS: { habitable: 1.0, diversity: 3.0, proximity: 0.5 },
  /** Bootstrap-spark population a new colony receives, transferred (conserved) from the nearest
   * developed same-faction system. Deliberately tiny (seed model C): a big seed drains the source
   * and dumps pops on a jobless world faster than jobs form — instead the spark staffs a first
   * local basic, whose jobs then pull job-aware migration in to grow the colony at its own pace. */
  COLONY_SEED_POP: 2,
} as const;
