import { ECONOMY_UPDATE_INTERVAL } from "@/lib/constants/tick-cadence";

/**
 * Directed-build (faction build planner) tuning. First-draft, simulator-calibrated;
 * only relative shape matters. The up-arrow twin of SP3.5 infrastructure decay.
 * See docs/active/gameplay/economy-autonomic-agency.md.
 */
export const DIRECTED_BUILD = {
  /** Ticks for the per-faction shard to sweep every faction once — the agency clock (matches logistics). */
  INTERVAL: 2 * ECONOMY_UPDATE_INTERVAL,
  /** Build-unit budget a system contributes per cycle = population × this. Free + capacity-bounded in v1. */
  GENERATION_PER_POP: 0.05,
  /** Reachability horizon, shared with logistics (tunable; see hop-cap note in the design). */
  MAX_HOPS: 4,
  /** Per-unit route cost = hops × this (proximity weight in placement scoring). */
  HOP_WEIGHT: 1.0,
  /** "Fed" gate: grow housing only where supply-dissatisfaction D ≤ this (0…1). */
  D_SETTLE: 0.15,
  /** "Calm" gate: grow housing only where stored unrest ≤ this (0…1). */
  UNREST_SETTLE: 0.2,
  /** Housing is paced to keep popCap at most this fraction ahead of current population. */
  SETTLE_MARGIN: 0.25,
} as const;
