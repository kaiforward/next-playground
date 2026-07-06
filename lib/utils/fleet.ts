import type { ShipState } from "@/lib/types/game";

/** Ships docked at a specific system. */
export function getDockedShips(ships: ShipState[], systemId: string): ShipState[] {
  return ships.filter((s) => s.status === "docked" && s.systemId === systemId);
}
