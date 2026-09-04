import { scaleValue } from "@/lib/constants/economy-scale";

/**
 * Persistent-lane tuning (docs/planned/logistics-lanes.md §1-2). First-draft, simulator-calibrated
 * — nothing here has been measured against a real haul yet; every value is a proposal carrying its
 * own rationale, only the relative shape matters until it is calibrated against actual lane traffic.
 */
export const LANES = {
  /**
   * Baseline lane capacity at level 0 — a goods VOLUME per reference cycle, denominated with
   * `scaleValue` exactly as `DIRECTED_LOGISTICS.GENERATION_PER_POP`
   * (`lib/constants/directed-logistics.ts`) is, so it moves with `ECONOMY_SCALE` rather than reading
   * as a fixed absolute. No measured target volume exists — nothing routes goods over lanes yet —
   * so this is a round order-of-magnitude guess sized to read as "comfortably carries a young
   * colony's resupply, but a mature multi-system corridor cannot run on it alone" (§1's own
   * framing), not a derived number.
   */
  BASE_LANE_CAPACITY: scaleValue(10),

  /**
   * Ceiling on the congestion multiplier a not-yet-excluded edge's route cost can carry — the
   * spec's own figure (§2: "bounded above by a stated constant … ~3×"). An edge whose booked load
   * reaches capacity is excluded from the route graph outright (route cost null) rather than priced
   * past this, so the bound only ever prices edges approaching, never at, saturation.
   */
  CONGESTION_MAX: 3,

  /**
   * Fuel cost a haul crosses per tick in transit. Sized against a typical intra-cluster haul: a
   * generated lane normalises to roughly one baseline hop's fuel cost (`laneFuelCost`,
   * `lib/engine/universe-gen.ts`), and a typical single-lane cost is ~8.5 fuel. At speed 5, a 1-lane
   * haul (~8.5 fuel) takes ~1.7 ticks and a 3-lane haul (~25.5 fuel) takes ~5.1 ticks — both inside a
   * quarter of the 24-tick `LOGISTICS_INTERVAL` (6 ticks), so freight latency reads as "a few
   * ticks", not a material delay against the interval it rides.
   */
  FREIGHT_SPEED: 5,

  /**
   * Construction work to raise a lane by one level — priced against a mid-tier building's per-level
   * work cost (`workCostPerLevel`, `lib/constants/construction.ts`: a tier-1 factory is 20, a
   * tier-2 factory 30, a specialisation complex 40) so a lane upgrade competes for the same
   * construction pool on comparable terms, rather than reading as free or as a pool-monopolising
   * sink.
   */
  UPGRADE_WORK_PER_LEVEL: 20,

  /**
   * Reference cycles a lane level must sit fully idle — its whole marginal capacity unused, where
   * "used" means attempted load (booked plus congestion-diverted volume, §1) — before it decays one
   * level. The lane analogue of `INFRASTRUCTURE_DECAY_PARAMS.idleBufferCycles`
   * (`lib/constants/infrastructure.ts`, 120): matched at the same order of magnitude so an invested
   * lane is at least as sticky as invested building capacity, per §1's decay design ("mirroring
   * idleLevels + hysteresis").
   */
  IDLE_BUFFER_CYCLES: 120,

  /**
   * Cycles between one player claim and the next (§1's new player claim verb — no comparable
   * existing mechanic to size this against). Small enough that a player still feels the pacing (a
   * multi-hop corridor push takes several cycles, "a deliberate, paced act") without reading as a
   * long wait for a single free claim.
   */
  PLAYER_CLAIM_COOLDOWN: 6,
} as const;
