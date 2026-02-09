import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionPlayer } from "@/lib/auth/get-player";
import { serializeShip } from "@/lib/auth/serialize";
import { validateFleetRouteNavigation } from "@/lib/engine/navigation";
import type { ShipNavigateRequest, ShipNavigateResponse } from "@/lib/types/api";

/**
 * POST /api/game/ship/[shipId]/navigate
 * Order a ship to navigate a multi-hop route.
 * All fuel is deducted upfront; ship travels the full route as one continuous transit.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ shipId: string }> },
) {
  try {
    const { shipId } = await params;

    let body: ShipNavigateRequest;
    try {
      body = (await request.json()) as ShipNavigateRequest;
    } catch {
      return NextResponse.json<ShipNavigateResponse>(
        { error: "Invalid JSON body." },
        { status: 400 },
      );
    }
    const { route } = body;

    if (
      !route ||
      !Array.isArray(route) ||
      route.length < 2 ||
      !route.every((id) => typeof id === "string" && id.length > 0)
    ) {
      return NextResponse.json<ShipNavigateResponse>(
        { error: "Missing or invalid route. Must be an array of at least 2 system IDs." },
        { status: 400 },
      );
    }

    const player = await getSessionPlayer();
    if (!player) {
      return NextResponse.json<ShipNavigateResponse>(
        { error: "Player not found." },
        { status: 404 },
      );
    }

    // Find the ship and verify ownership
    const ship = player.ships.find((s) => s.id === shipId);
    if (!ship) {
      return NextResponse.json<ShipNavigateResponse>(
        { error: "Ship not found or does not belong to you." },
        { status: 404 },
      );
    }

    // Route must start at ship's current location
    if (route[0] !== ship.systemId) {
      return NextResponse.json<ShipNavigateResponse>(
        { error: "Route must start at the ship's current system." },
        { status: 400 },
      );
    }

    // Get current game world for tick info
    const world = await prisma.gameWorld.findUnique({
      where: { id: "world" },
    });
    if (!world) {
      return NextResponse.json<ShipNavigateResponse>(
        { error: "Game world not initialized." },
        { status: 500 },
      );
    }

    // Fetch ALL connections (multi-hop needs the full graph)
    const connections = await prisma.systemConnection.findMany({
      select: { fromSystemId: true, toSystemId: true, fuelCost: true },
    });

    // Validate the full route
    const result = validateFleetRouteNavigation({
      route,
      connections,
      currentFuel: ship.fuel,
      shipStatus: ship.status as "docked" | "in_transit",
      currentTick: world.currentTick,
    });

    if (!result.ok) {
      return NextResponse.json<ShipNavigateResponse>(
        { error: result.error },
        { status: 400 },
      );
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
      return NextResponse.json<ShipNavigateResponse>(
        { error: "Ship state changed. Please try again." },
        { status: 409 },
      );
    }

    return NextResponse.json<ShipNavigateResponse>({
      data: {
        ship: serializeShip(updatedShip),
        fuelUsed: result.totalFuelCost,
        travelDuration: result.totalTravelDuration,
      },
    });
  } catch (error) {
    console.error("POST /api/game/ship/[shipId]/navigate error:", error);
    return NextResponse.json<ShipNavigateResponse>(
      { error: "Failed to navigate." },
      { status: 500 },
    );
  }
}
