import type { ShipState } from "@/lib/types/game";
import type { StatGateKey } from "@/lib/constants/missions";

/** Check whether a ship meets all stat requirements for a mission. */
export function isShipEligible(
  ship: ShipState,
  statRequirements: Partial<Record<StatGateKey, number>>,
): boolean {
  const stats: Record<StatGateKey, number> = {
    firepower: ship.firepower,
    sensors: ship.sensors,
    hullMax: ship.hullMax,
    stealth: ship.stealth,
  };
  for (const [stat, required] of Object.entries(statRequirements)) {
    if ((stats[stat as StatGateKey] ?? 0) < required) return false;
  }
  return true;
}
