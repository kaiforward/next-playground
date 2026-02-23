import type { ShipState, ConvoyState } from "./game";

// ── NavigableUnit — discriminated union for ships and convoys ──

export type NavigableUnit =
  | { kind: "ship"; id: string; name: string; fuel: number; maxFuel: number; speed: number; systemId: string; ship: ShipState }
  | { kind: "convoy"; id: string; name: string; fuel: number; maxFuel: number; speed: number; systemId: string; convoy: ConvoyState };

/** Wrap a solo ship as a NavigableUnit. */
export function shipToNavigableUnit(ship: ShipState): NavigableUnit {
  return {
    kind: "ship",
    id: ship.id,
    name: ship.name,
    fuel: ship.fuel,
    maxFuel: ship.maxFuel,
    speed: ship.speed,
    systemId: ship.systemId,
    ship,
  };
}

/** Wrap a convoy as a NavigableUnit. Fuel/speed = min across members. */
export function convoyToNavigableUnit(convoy: ConvoyState): NavigableUnit {
  const members = convoy.members;
  const fuel = members.length > 0 ? Math.min(...members.map((m) => m.fuel)) : 0;
  const maxFuel = members.length > 0 ? Math.min(...members.map((m) => m.maxFuel)) : 0;
  const speed = members.length > 0 ? Math.min(...members.map((m) => m.speed)) : 1;

  return {
    kind: "convoy",
    id: convoy.id,
    name: convoy.name ?? "Convoy",
    fuel,
    maxFuel,
    speed,
    systemId: convoy.systemId,
    convoy,
  };
}

/** Return only ships that are NOT in a convoy. */
export function getSoloShips(ships: ShipState[]): ShipState[] {
  return ships.filter((s) => !s.convoyId);
}
