import type { ShipState, ShipActiveMission, ConvoyState, UpgradeSlotState } from "@/lib/types/game";
import { toShipStatus, toEconomyType, toShipSize, toShipRole, toUpgradeSlotType, toConvoyStatus } from "@/lib/types/guards";
import { SHIP_TYPES } from "@/lib/constants/ships";
import { isShipTypeId } from "@/lib/types/guards";
import { computeUpgradeBonuses, type InstalledModule } from "@/lib/engine/upgrades";

// ── System serialization helper ──────────────────────────────────

interface RawSystem {
  id: string;
  name: string;
  economyType: string;
  x: number;
  y: number;
  description: string;
  regionId: string;
  isGateway: boolean;
}

function serializeSystem(sys: RawSystem) {
  return {
    id: sys.id,
    name: sys.name,
    economyType: toEconomyType(sys.economyType),
    x: sys.x,
    y: sys.y,
    description: sys.description,
    regionId: sys.regionId,
    isGateway: sys.isGateway,
  };
}

// ── Ship serialization ───────────────────────────────────────────

/**
 * Serialize a Prisma ship record (with included relations) into a ShipState.
 * Keeps this in one place so all API routes return consistent shapes.
 */
export function serializeShip(ship: {
  id: string;
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
  disabled: boolean;
  status: string;
  systemId: string;
  destinationSystemId: string | null;
  departureTick: number | null;
  arrivalTick: number | null;
  system: RawSystem;
  destination: RawSystem | null;
  cargo: Array<{
    goodId: string;
    quantity: number;
    good: { name: string };
  }>;
  upgradeSlots?: Array<{
    id: string;
    slotType: string;
    slotIndex: number;
    moduleId: string | null;
    moduleTier: number | null;
  }>;
  convoyMember?: { convoyId: string } | null;
}, activeMission?: ShipActiveMission | null): ShipState {
  const shipType = ship.shipType;
  const typeDef = isShipTypeId(shipType) ? SHIP_TYPES[shipType] : null;

  return {
    id: ship.id,
    name: ship.name,
    shipType: ship.shipType,
    size: typeDef ? typeDef.size : toShipSize("small"),
    role: typeDef ? typeDef.role : toShipRole("trade"),
    fuel: ship.fuel,
    maxFuel: ship.maxFuel,
    cargoMax: ship.cargoMax,
    speed: ship.speed,
    hullMax: ship.hullMax,
    hullCurrent: ship.hullCurrent,
    shieldMax: ship.shieldMax,
    shieldCurrent: ship.shieldCurrent,
    firepower: ship.firepower,
    evasion: ship.evasion,
    stealth: ship.stealth,
    sensors: ship.sensors,
    crewCapacity: ship.crewCapacity,
    disabled: ship.disabled,
    status: toShipStatus(ship.status),
    systemId: ship.systemId,
    system: serializeSystem(ship.system),
    destinationSystemId: ship.destinationSystemId,
    destinationSystem: ship.destination ? serializeSystem(ship.destination) : null,
    departureTick: ship.departureTick,
    arrivalTick: ship.arrivalTick,
    cargo: ship.cargo.map((c) => ({
      goodId: c.goodId,
      goodName: c.good.name,
      quantity: c.quantity,
    })),
    upgradeSlots: (ship.upgradeSlots ?? []).map((s): UpgradeSlotState => ({
      id: s.id,
      slotType: toUpgradeSlotType(s.slotType),
      slotIndex: s.slotIndex,
      moduleId: s.moduleId,
      moduleTier: s.moduleTier,
    })),
    convoyId: ship.convoyMember?.convoyId ?? null,
    activeMission: activeMission ?? null,
  };
}

// ── Convoy serialization ─────────────────────────────────────────

/**
 * Serialize a Prisma convoy record into a ConvoyState.
 */
export function serializeConvoy(convoy: {
  id: string;
  playerId: string;
  name: string | null;
  systemId: string;
  status: string;
  destinationSystemId: string | null;
  departureTick: number | null;
  arrivalTick: number | null;
  system: RawSystem;
  destination: RawSystem | null;
  members: Array<{
    ship: Parameters<typeof serializeShip>[0];
  }>;
}): ConvoyState {
  const members = convoy.members.map((m) => serializeShip(m.ship));
  const combinedCargoMax = members.reduce((sum, s) => {
    const installed: InstalledModule[] = s.upgradeSlots
      .filter((slot): slot is typeof slot & { moduleId: string; moduleTier: number } =>
        slot.moduleId !== null && slot.moduleTier !== null)
      .map((slot) => ({ moduleId: slot.moduleId, moduleTier: slot.moduleTier, slotType: slot.slotType }));
    const bonuses = computeUpgradeBonuses(installed);
    return sum + s.cargoMax + bonuses.cargoBonus;
  }, 0);
  const combinedCargoUsed = members.reduce(
    (sum, s) => sum + s.cargo.reduce((cs, c) => cs + c.quantity, 0),
    0,
  );

  return {
    id: convoy.id,
    playerId: convoy.playerId,
    name: convoy.name,
    systemId: convoy.systemId,
    system: serializeSystem(convoy.system),
    status: toConvoyStatus(convoy.status),
    destinationSystemId: convoy.destinationSystemId,
    destinationSystem: convoy.destination ? serializeSystem(convoy.destination) : null,
    departureTick: convoy.departureTick,
    arrivalTick: convoy.arrivalTick,
    members,
    combinedCargoMax,
    combinedCargoUsed,
  };
}
