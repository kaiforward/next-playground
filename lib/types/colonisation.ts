/**
 * Client-safe colony-block vocabulary. Both the construction-orders mutation service (order
 * validation) and the build-options read service classify ineligibility against this same set, and
 * `components/construction/colony-section.tsx` renders its copy directly — this module imports
 * nothing from `lib/services` or `lib/world`, so a client component can pull it in without dragging
 * the world store into the client bundle.
 */

/** Why a controlled system can't take a colony order right now (mirrors planner eligibility). */
export type ColonyBlockReason = "already_forming" | "below_habitable_floor" | "no_seed_source";

/** User-facing copy for each block reason — shared by the order error and the Industry-tab UI. */
export const COLONY_BLOCK_COPY: Record<ColonyBlockReason, string> = {
  already_forming: "A colony is already forming here.",
  below_habitable_floor: "Below the habitable floor — this world cannot hold a colony.",
  no_seed_source: "No developed system in range to seed a colony from.",
};
