import { REFERENCE_SPEED } from "@/lib/constants/ships";

/**
 * Travel duration in ticks for a single hop given its fuel cost.
 *
 * Without speed args: backward-compatible with existing behavior (fuel/2, min 1).
 * With shipSpeed: scales travel time by speed relative to reference.
 * Faster ships (higher speed) travel in fewer ticks.
 *
 * Formula: max(1, ceil(baseTicks * referenceSpeed / shipSpeed))
 * where baseTicks = max(1, ceil(fuelCost / 2))
 */
export function hopDuration(
  fuelCost: number,
  shipSpeed?: number,
  referenceSpeed: number = REFERENCE_SPEED,
): number {
  const baseTicks = Math.max(1, Math.ceil(fuelCost / 2));

  if (shipSpeed === undefined || shipSpeed <= 0) {
    return baseTicks;
  }

  return Math.max(1, Math.ceil(baseTicks * referenceSpeed / shipSpeed));
}
