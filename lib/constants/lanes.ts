import { scaleValue } from "@/lib/constants/economy-scale";

/**
 * Persistent-lane tuning (docs/active/gameplay/logistics-lanes.md §1-2). First-draft, simulator-calibrated
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
   * Fuel cost a haul crosses per tick in transit — the freight convoy's pace, set by the fiction
   * rather than by the logistics interval. Anchor: a bulk convoy is slower than the roster's large
   * freighter (`hopDuration` at speed 2 ≈ 12 ticks, three days, per ordinary lane). A generated lane
   * normalises to roughly one baseline hop's fuel (`laneFuelCost`, `lib/engine/universe-gen.ts`),
   * ~8.5 fuel, so at 0.5 an ordinary lane takes ~17 ticks (about four days), a corridor crossing
   * roughly ten days, and a three-lane supply run about two economic cycles. Transit is meant to be
   * felt: goods are visibly in flight, and a shortfall waits on them (owner decision — the delay is a
   * mechanic, not a detail). Measured at 10,000 ticks against the 5-fuel/tick baseline: survival-good
   * deficit spells lengthen from a 1-cycle median / 4-cycle p90 to 2 / 10, no system trips the
   * survival-stock alert, all conservation identities hold, and overshoot stays under 0.2% of volume.
   */
  FREIGHT_SPEED: 0.5,

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
