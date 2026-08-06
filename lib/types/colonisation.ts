/**
 * Client-safe colony vocabulary: why a colony cannot be ordered, and why one already ordered is
 * making no progress. The construction-orders mutation service (order validation), the build-options
 * read service (ineligibility) and the construction readout (stalls) all classify against these sets,
 * and the construction components render their copy directly — this module imports nothing from
 * `lib/services` or `lib/world`, so a client component can pull it in without dragging the world
 * store into the client bundle.
 */

/** Why a controlled system can't take a colony order right now (mirrors planner eligibility). */
export type ColonyBlockReason =
  | "already_forming"
  | "below_habitable_floor"
  | "no_seed_source"
  | "insufficient_funds";

/** User-facing copy for each block reason — shared by the order error and the Industry-tab UI. */
export const COLONY_BLOCK_COPY: Record<ColonyBlockReason, string> = {
  already_forming: "A colony is already forming here.",
  below_habitable_floor: "Below the habitable floor — this world cannot hold a colony.",
  no_seed_source: "No developed system in range to seed a colony from.",
  insufficient_funds: "The treasury cannot cover the charter and the materials it will owe.",
};

/** What a committed founding is waiting on, in the order the causes bind. */
export type ColonyStallReason = "awaiting_charter" | "awaiting_funds" | "awaiting_materials";

/** Short badge copy for a stalled founding — what is missing, in the player's terms. */
export const COLONY_STALL_COPY: Record<ColonyStallReason, string> = {
  awaiting_charter: "awaiting charter",
  awaiting_funds: "awaiting funds",
  awaiting_materials: "awaiting materials",
};

/** The line under a stalled founding: what is missing, and what would clear it. */
export const COLONY_STALL_DETAIL: Record<ColonyStallReason, string> = {
  awaiting_charter: "The charter is unpaid — no work is absorbed until the treasury can cover it.",
  awaiting_funds: "The treasury cannot pay for the next materials, so none are being staged.",
  awaiting_materials: "The source has nothing to spare for the manifest right now.",
};
