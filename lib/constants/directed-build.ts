/**
 * Directed-build (faction build planner) tuning. First-draft, simulator-calibrated;
 * only relative shape matters. The up-arrow twin of SP3.5 infrastructure decay.
 * See docs/active/gameplay/economy-autonomic-agency.md.
 */
export const DIRECTED_BUILD = {
  /** Reachability horizon, shared with logistics (tunable; see hop-cap note in the design). */
  MAX_HOPS: 4,
  /** Per-unit route cost = hops × this (proximity weight in placement scoring). */
  HOP_WEIGHT: 1.0,
  /** Per-unit route cost of a system serving ITSELF — the cheapest positive route, so self-supply
   *  outranks export in the planner's served ÷ cost scoring. Must be 0 < SELF_COST < HOP_WEIGHT. */
  SELF_COST: 0.5,
  /** "Fed" gate: grow housing only where CIVILIAN, necessity-weighted supply-dissatisfaction D ≤ this
   *  (0…1). Cut above the ambient barren-galaxy deficit (≈0.14 under GOOD_NECESSITY, which every
   *  import-short world carries and which must not block housing) and below D_SHORTAGE_CUT, so a
   *  system the simulation calls starving never stands up new housing. First cut; the simulator owns
   *  the final. */
  D_SETTLE: 0.20,
  /** Relief trigger: autonomic housing builds once occupancy r = pop/popCap rises past this. */
  RELIEF_TRIGGER: 0.95,
  /** Relief sizing: build enough whole levels to return r to ≈ this. Multi-level relief must land
   *  inside the housing decay allowance — RELIEF_TARGET × (1 + VACANCY_SLACK) ≥ 1 — so the levels it
   *  commits still read as used. Whole-level round-up drops a small site well below the target (a
   *  1-level seed lands at r = 0.5), so that containment is a multi-level property, not a per-site one. */
  RELIEF_TARGET: 0.92,
  /**
   * Speculative self-supply floor (§3.2): the largest fraction of a basic's LOCAL demand an
   * undeveloped system stands up locally even when imports already cover it. The live floor is
   * this × (1 − systemDevelopment), so it is strongest on a raw colony and fades to nothing as the
   * system matures — a bounded floor, not autarky, so specialisation survives. Calibrated against
   * the simulator.
   */
  SPECULATIVE_FLOOR: 0.5,
  /** Capacity is deliberately held 10% above measured demand before it is structurally complete. */
  PROVISION_MARGIN: 0.10,
  /** Consecutive post-net construction assessments required before a structural build may emit. */
  PERSISTENCE_PULSES: 2,
  /** Fraction of a persistent structural residual that one assessment may commit. */
  BUILD_RATE_CAP: 0.40,
} as const;

/**
 * Un-repurposable basics the speculative nudge (§3.2 / §7.7) self-supplies: a deposit for one of
 * these can only ever make that good, so importing a basic you are sitting on is pure waste. Kept
 * narrow (staples) so the floor never crowds out real specialisation.
 */
export const SPECULATIVE_BASICS: readonly string[] = ["food", "water"];
