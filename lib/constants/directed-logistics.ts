import { ECONOMY_UPDATE_INTERVAL } from "@/lib/constants/tick-cadence";

/**
 * Directed-logistics tuning. First-draft, simulator-calibrated; only relative shape matters.
 * See docs/plans/sp5-autonomic-logistics.md.
 */
export const DIRECTED_LOGISTICS = {
  /** Ticks for the per-faction shard to sweep every faction once (2× the economy clock). */
  INTERVAL: 2 * ECONOMY_UPDATE_INTERVAL,
  /** Work-budget a system contributes per cycle = population × this. Free in v1 (no treasury). */
  GENERATION_PER_POP: 0.5,
  /** A good is a surplus when stock ≥ targetStock × this (held above its days-of-supply anchor). Margin > 1 leaves a deliberate residual (negative space). */
  SURPLUS_MARGIN: 1.4,
  /** A good is a deficit when stock < targetStock × this (below its days-of-supply anchor). < 1 leaves a comfortable dead-band above it (with SURPLUS_MARGIN) — the residual / negative space. */
  DEFICIT_FRACTION: 0.8,
  /** Max hops a logistics transfer may span (beyond this, route cost is treated as unreachable). */
  MAX_HOPS: 4,
  /** Per-unit route cost = quantity × (hops × HOP_WEIGHT + totalFuelCost × FUEL_WEIGHT). */
  HOP_WEIGHT: 1.0,
  FUEL_WEIGHT: 0.1,
  /**
   * Top-K most-valuable matched transfers per faction per cycle exposed as player
   * Contracts (the rest move silently). The agency dial: constant in v1; scaling by
   * player count/activity is an SP5+ hook. First-draft — calibrate against the simulator.
   */
  CONTRACTS_PER_CYCLE: 5,
  /**
   * Ticks a logistics Contract stays open before the faction hauls it itself. One
   * INTERVAL, so a Contract created on a faction's shard run is due for timeout-resolve
   * on that same faction's NEXT shard run (sharding is per-faction + deterministic).
   */
  CONTRACT_DEADLINE_TICKS: 2 * ECONOMY_UPDATE_INTERVAL,
} as const;
