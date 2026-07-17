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
  /** "Fed" gate: grow housing only where supply-dissatisfaction D ≤ this (0…1). */
  D_SETTLE: 0.15,
  /** "Calm" gate: grow housing only where stored unrest ≤ this (0…1). */
  UNREST_SETTLE: 0.2,
  /** Housing is paced to keep popCap at most this fraction ahead of current population. */
  SETTLE_MARGIN: 0.25,
  /**
   * Speculative self-supply floor (§3.2): the largest fraction of a basic's LOCAL demand an
   * undeveloped system stands up locally even when imports already cover it. The live floor is
   * this × (1 − systemDevelopment), so it is strongest on a raw colony and fades to nothing as the
   * system matures — a bounded floor, not autarky, so specialisation survives. Calibrated in PR4.
   */
  SPECULATIVE_FLOOR: 0.5,
} as const;

/**
 * Un-repurposable basics the speculative nudge (§3.2 / §7.7) self-supplies: a deposit for one of
 * these can only ever make that good, so importing a basic you are sitting on is pure waste. Kept
 * narrow (staples) so the floor never crowds out real specialisation.
 */
export const SPECULATIVE_BASICS: readonly string[] = ["food", "water"];
