import { prisma } from "@/lib/prisma";
import { serializeShip } from "@/lib/auth/serialize";
import { validateFleetRouteNavigation } from "@/lib/engine/navigation";
import type { ShipNavigateResult } from "@/lib/types/api";

type NavigationResult =
  | { ok: true; data: ShipNavigateResult }
  | { ok: false; error: string; status: number };

/**
 * Execute multi-hop navigation for a ship.
 * Preserves full TOCTOU transaction guard from the original route handler.
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

  // Fetch player with ships to verify ownership
  const player = await prisma.player.findUnique({
    where: { id: playerId },
    include: {
      ships: {
        include: {
          cargo: { include: { good: true } },
          system: true,
          destination: true,
        },
      },
    },
  });

  if (!player) {
    return { ok: false, error: "Player not found.", status: 404 };
  }

  const ship = player.ships.find((s) => s.id === shipId);
  if (!ship) {
    return { ok: false, error: "Ship not found or does not belong to you.", status: 404 };
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
    shipStatus: ship.status as "docked" | "in_transit",
    currentTick: world.currentTick,
  });

  if (!result.ok) {
    return { ok: false, error: result.error, status: 400 };
  }

  // Execute navigation in a transaction with fresh state check (TOCTOU guard)
  const updatedShip = await prisma.$transaction(async (tx) => {
    const freshShip = await tx.ship.findUnique({
      where: { id: shipId },
      select: { status: true, fuel: true },
    });

    if (!freshShip || freshShip.status !== "docked" || freshShip.fuel < result.totalFuelCost) {
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
      include: {
        cargo: { include: { good: true } },
        system: true,
        destination: true,
      },
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
