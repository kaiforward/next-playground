import type { ShipState, ConvoyState, CargoItemState } from "./game";

// ── FleetUnitRef — lightweight identity for ship/convoy selection ──

/** Reference to a ship or convoy by kind + id. Used as select dropdown values. */
export type FleetUnitRef = { kind: "ship" | "convoy"; id: string };

// ── TradableUnit — discriminated projection for trading contexts ──

/**
 * A ship or convoy projected for trading. Parallel to NavigableUnit for navigation.
 * Provides the common shape that trade UI components need regardless of whether
 * the trading entity is a single ship or a convoy.
 */
export interface TradableUnit {
  kind: "ship" | "convoy";
  id: string;
  name: string;
  cargoMax: number;
  cargo: CargoItemState[];
}

/** Wrap a solo ship as a TradableUnit. */
export function shipToTradableUnit(ship: ShipState): TradableUnit {
  return {
    kind: "ship",
    id: ship.id,
    name: ship.name,
    cargoMax: ship.cargoMax,
    cargo: ship.cargo,
  };
}

/** Wrap a convoy as a TradableUnit. Cargo is aggregated across all member ships. */
export function convoyToTradableUnit(convoy: ConvoyState): TradableUnit {
  const cargoMap = new Map<string, CargoItemState>();
  for (const member of convoy.members) {
    for (const item of member.cargo) {
      const existing = cargoMap.get(item.goodId);
      if (existing) {
        existing.quantity += item.quantity;
      } else {
        cargoMap.set(item.goodId, { ...item });
      }
    }
  }

  return {
    kind: "convoy",
    id: convoy.id,
    name: convoy.name ?? "Convoy",
    cargoMax: convoy.combinedCargoMax,
    cargo: [...cargoMap.values()],
  };
}
