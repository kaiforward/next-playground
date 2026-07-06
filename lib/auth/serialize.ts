import type { ShipState } from "@/lib/types/game";
import { toShipStatus, toEconomyType, toShipSize, toShipRole } from "@/lib/types/guards";
import { SHIP_TYPES } from "@/lib/constants/ships";
import { isShipTypeId } from "@/lib/types/guards";

// ── System serialization helper ──────────────────────────────────

interface RawSystem {
  id: string;
  name: string;
  economyType: string;
  x: number;
  y: number;
  description: string;
  regionId: string;
  factionId: string | null;
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
    factionId: sys.factionId,
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
}): ShipState {
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
  };
}
