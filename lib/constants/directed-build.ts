import { ECONOMY_UPDATE_INTERVAL } from "@/lib/constants/tick-cadence";

/**
 * Directed-build (faction build planner) tuning. First-draft, simulator-calibrated;
 * only relative shape matters. The up-arrow twin of SP3.5 infrastructure decay.
 * See docs/active/gameplay/economy-autonomic-agency.md.
 */
export const DIRECTED_BUILD = {
  /** Ticks between agency sweeps: every faction plans builds on the monthly resolution pulse (matches logistics). */
  INTERVAL: ECONOMY_UPDATE_INTERVAL,
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
} as const;
