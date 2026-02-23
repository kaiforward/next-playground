/**
 * Pure ship factory — creates ship data objects from ship type definitions.
 * Used by registration, shipyard, and seed to ensure consistent ship creation.
 */

import type { ShipTypeDefinition, UpgradeSlotType, SlotLayout } from "@/lib/constants/ships";

export interface ShipCreateData {
  name: string;
  shipType: string;
  fuel: number;
  maxFuel: number;
  cargoMax: number;
  speed: number;
  hullMax: number;
  hullCurrent: number;
  shieldMax: number;
  shieldCurrent: number;
  firepower: number;
  evasion: number;
  stealth: number;
  sensors: number;
  crewCapacity: number;
  status: "docked";
}

export interface UpgradeSlotCreateData {
  slotType: string;
  slotIndex: number;
}

/**
 * Build the ship data fields from a ship type definition.
 * Does not include systemId or playerId — caller provides those.
 */
export function buildShipData(def: ShipTypeDefinition, name: string): ShipCreateData {
  return {
    name,
    shipType: def.id,
    fuel: def.fuel,
    maxFuel: def.fuel,
    cargoMax: def.cargo,
    speed: def.speed,
    hullMax: def.hullMax,
    hullCurrent: def.hullMax,
    shieldMax: def.shieldMax,
    shieldCurrent: def.shieldMax,
    firepower: def.firepower,
    evasion: def.evasion,
    stealth: def.stealth,
    sensors: def.sensors,
    crewCapacity: def.crewCapacity,
    status: "docked",
  };
}

/**
 * Build the upgrade slot create data from a slot layout.
 * Returns an array of { slotType, slotIndex } for Prisma createMany.
 */
export function buildUpgradeSlots(layout: SlotLayout): UpgradeSlotCreateData[] {
  const slots: UpgradeSlotCreateData[] = [];
  const slotTypes: UpgradeSlotType[] = ["engine", "cargo", "defence", "systems"];

  for (const slotType of slotTypes) {
    const count = layout[slotType];
    for (let i = 0; i < count; i++) {
      slots.push({ slotType, slotIndex: i });
    }
  }

  return slots;
}
