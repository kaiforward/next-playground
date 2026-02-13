import type { ShipState, ShipStatus, EconomyType } from "@/lib/types/game";

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
  status: string;
  systemId: string;
  destinationSystemId: string | null;
  departureTick: number | null;
  arrivalTick: number | null;
  system: {
    id: string;
    name: string;
    economyType: string;
    x: number;
    y: number;
    description: string;
    regionId: string;
    isGateway: boolean;
  };
  destination: {
    id: string;
    name: string;
    economyType: string;
    x: number;
    y: number;
    description: string;
    regionId: string;
    isGateway: boolean;
  } | null;
  cargo: Array<{
    goodId: string;
    quantity: number;
    good: { name: string };
  }>;
}): ShipState {
  return {
    id: ship.id,
    name: ship.name,
    shipType: ship.shipType,
    fuel: ship.fuel,
    maxFuel: ship.maxFuel,
    cargoMax: ship.cargoMax,
    status: ship.status as ShipStatus,
    systemId: ship.systemId,
    system: {
      id: ship.system.id,
      name: ship.system.name,
      economyType: ship.system.economyType as EconomyType,
      x: ship.system.x,
      y: ship.system.y,
      description: ship.system.description,
      regionId: ship.system.regionId,
      isGateway: ship.system.isGateway,
    },
    destinationSystemId: ship.destinationSystemId,
    destinationSystem: ship.destination
      ? {
          id: ship.destination.id,
          name: ship.destination.name,
          economyType: ship.destination.economyType as EconomyType,
          x: ship.destination.x,
          y: ship.destination.y,
          description: ship.destination.description,
          regionId: ship.destination.regionId,
          isGateway: ship.destination.isGateway,
        }
      : null,
    departureTick: ship.departureTick,
    arrivalTick: ship.arrivalTick,
    cargo: ship.cargo.map((c) => ({
      goodId: c.goodId,
      goodName: c.good.name,
      quantity: c.quantity,
    })),
  };
}
