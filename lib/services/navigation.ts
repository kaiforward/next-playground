import { prisma } from "@/lib/prisma";
import { serializeShip } from "@/lib/auth/serialize";
import { validateFleetRouteNavigation } from "@/lib/engine/navigation";
import { toShipStatus } from "@/lib/types/guards";
import { SHIP_INCLUDE } from "./fleet";
import type { ShipNavigateResult } from "@/lib/types/api";

type NavigationResult =
  | { ok: true; data: ShipNavigateResult }
  | { ok: false; error: string; status: number };

/**
 * Execute multi-hop navigation for a ship.
 * Uses ship speed for travel time calculation.
 * Preserves full TOCTOU transaction guard.
 */
export async function executeNavigation(
  playerId: string,
  shipId: string,
  route: string[],
): Promise<NavigationResult> {
  if (
    !route ||
    !Array.isArray(route) ||
    route.length < 2 ||
    !route.every((id) => typeof id === "string" && id.length > 0)
  ) {
    return { ok: false, error: "Missing or invalid route. Must be an array of at least 2 system IDs.", status: 400 };
  }

  // Fetch player (existence check) + ship by ID, verify ownership
  const player = await prisma.player.findUnique({
    where: { id: playerId },
    select: { id: true },
  });

  if (!player) {
    return { ok: false, error: "Player not found.", status: 404 };
  }

  const ship = await prisma.ship.findUnique({
    where: { id: shipId },
    select: { id: true, playerId: true, fuel: true, speed: true, status: true, systemId: true, disabled: true, convoyMember: { select: { convoyId: true } } },
  });

  if (!ship || ship.playerId !== playerId) {
    return { ok: false, error: "Ship not found or does not belong to you.", status: 404 };
  }

  if (ship.convoyMember) {
    return { ok: false, error: "This ship is in a convoy. Navigate via the convoy instead.", status: 400 };
  }

  if (ship.disabled) {
    return { ok: false, error: "Ship is disabled and cannot navigate. Repair it first.", status: 400 };
  }

  if (route[0] !== ship.systemId) {
    return { ok: false, error: "Route must start at the ship's current system.", status: 400 };
  }

  // Get current game world for tick info
  const world = await prisma.gameWorld.findUnique({
    where: { id: "world" },
  });
  if (!world) {
    return { ok: false, error: "Game world not initialized.", status: 500 };
  }

  // Fetch ALL connections (multi-hop needs the full graph)
  const connections = await prisma.systemConnection.findMany({
    select: { fromSystemId: true, toSystemId: true, fuelCost: true },
  });

  const result = validateFleetRouteNavigation({
    route,
    connections,
    currentFuel: ship.fuel,
    shipStatus: toShipStatus(ship.status),
    currentTick: world.currentTick,
    shipSpeed: ship.speed,
  });

  if (!result.ok) {
    return { ok: false, error: result.error, status: 400 };
  }

  // Execute navigation in a transaction with fresh state check (TOCTOU guard)
  const updatedShip = await prisma.$transaction(async (tx) => {
    const freshShip = await tx.ship.findUnique({
      where: { id: shipId },
      select: { status: true, fuel: true, disabled: true },
    });

    if (!freshShip || freshShip.status !== "docked" || freshShip.disabled || freshShip.fuel < result.totalFuelCost) {
      return null;
    }

    return tx.ship.update({
      where: { id: shipId },
      data: {
        fuel: freshShip.fuel - result.totalFuelCost,
        status: "in_transit",
        destinationSystemId: result.destinationSystemId,
        departureTick: result.departureTick,
        arrivalTick: result.arrivalTick,
      },
      include: SHIP_INCLUDE,
    });
  });

  if (!updatedShip) {
    return { ok: false, error: "Ship state changed. Please try again.", status: 409 };
  }

  return {
    ok: true,
    data: {
      ship: serializeShip(updatedShip),
      fuelUsed: result.totalFuelCost,
      travelDuration: result.totalTravelDuration,
    },
  };
}
