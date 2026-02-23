import type { ShipState, ConvoyState } from "@/lib/types/game";

/** Solo ships (not in a convoy) docked at a specific system. */
export function getDockedShips(ships: ShipState[], systemId: string): ShipState[] {
  return ships.filter(
    (s) => s.status === "docked" && s.systemId === systemId && !s.convoyId,
  );
}

/** Convoys docked at a specific system. */
export function getDockedConvoys(convoys: ConvoyState[], systemId: string): ConvoyState[] {
  return convoys.filter(
    (c) => c.status === "docked" && c.systemId === systemId,
  );
}
