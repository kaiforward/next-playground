/**
 * ShipArrivalsWorld — data interface for the ship-arrivals processor.
 *
 * The simulator has its own ship-arrival path
 * (`processSimShipArrivals` in `lib/engine/simulator/economy.ts`) and is
 * *not* migrated to this interface — doing so would require expanding the
 * SimWorld shape with cargo IDs, convoys, and upgrade slots. The live
 * orchestration follows the same World pattern as the rest. See
 * `docs/design/active/processor-architecture.md` for the broader pattern.
 */

import type { GovernmentType } from "@/lib/types/game";
import type { GeneratedTrait } from "@/lib/engine/trait-gen";
import type { ModifierRow } from "@/lib/engine/events";

export interface UpgradeSlotView {
  moduleId: string | null;
  moduleTier: number | null;
  slotType: string;
}

export interface CargoItemView {
  id: string;
  goodId: string;
  quantity: number;
}

/** Snapshot of a ship that has arrived at its destination this tick. */
export interface ArrivingShipView {
  id: string;
  name: string;
  destinationSystemId: string | null;
  playerId: string;
  hullMax: number;
  hullCurrent: number;
  shieldMax: number;
  shieldCurrent: number;
  firepower: number;
  evasion: number;
  stealth: number;
  cargo: CargoItemView[];
  destination: {
    name: string;
    governmentType: GovernmentType | null;
    traits: GeneratedTrait[];
    /** Σ body-archetype danger baselines for the destination system. */
    bodyDanger: number;
  } | null;
  upgradeSlots: UpgradeSlotView[];
  convoyId: string | null;
}

/** Initial dock + shield regen write. */
export interface DockShipUpdate {
  shipId: string;
  destinationSystemId: string;
  shieldCurrent: number;
}

/** Post-pipeline ship damage. `clearCargo` is set when the ship is disabled. */
export interface ShipDamageUpdate {
  shipId: string;
  hullCurrent: number;
  shieldCurrent: number;
  disabled: boolean;
  clearCargo: boolean;
}

/** Cargo mutation — quantity ≤ 0 means the row should be deleted. */
export interface CargoMutation {
  cargoItemId: string;
  newQuantity: number;
}

export interface ShipArrivalsWorld {
  /** Ships marked `in_transit` whose `arrivalTick` has come due. */
  getArrivingShips(currentTick: number): Promise<ArrivingShipView[]>;

  /** Navigation-domain modifiers targeting the given systems. */
  getNavModifiersForSystems(systemIds: string[]): Promise<ModifierRow[]>;

  /**
   * Dock the ship: status → "docked", clear destination/arrival columns,
   * set shieldCurrent (typically `shieldMax`, since shields regenerate
   * on dock).
   */
  dockShip(update: DockShipUpdate): Promise<void>;

  /** Apply post-arrival hull/shield damage; clear cargo when disabled. */
  applyShipDamage(update: ShipDamageUpdate): Promise<void>;

  /** Apply per-item cargo mutations (delete when quantity ≤ 0). */
  applyCargoMutations(mutations: CargoMutation[]): Promise<void>;

  /** Number of convoy members still `in_transit`. */
  countInTransitConvoyMembers(convoyId: string): Promise<number>;

  /** Dock a convoy whose members have all arrived. */
  dockConvoy(convoyId: string, systemId: string): Promise<void>;
}
