import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionPlayer } from "@/lib/auth/get-player";
import { validateNavigation } from "@/lib/engine/navigation";
import type { NavigateRequest, NavigateResponse } from "@/lib/types/api";
import type { EconomyType } from "@/lib/types/game";

/**
 * POST /api/game/navigate
 * Navigate the player's ship to a connected star system.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as NavigateRequest;
    const { targetSystemId } = body;

    if (!targetSystemId) {
      return NextResponse.json<NavigateResponse>(
        { error: "Missing required field: targetSystemId." },
        { status: 400 },
      );
    }

    const player = await getSessionPlayer();

    if (!player || !player.ship) {
      return NextResponse.json<NavigateResponse>(
        { error: "Player or ship not found." },
        { status: 404 },
      );
    }

    // Get connections from the player's current system
    const connections = await prisma.systemConnection.findMany({
      where: { fromSystemId: player.systemId },
      select: { fromSystemId: true, toSystemId: true, fuelCost: true },
    });

    // Validate navigation
    const result = validateNavigation({
      currentSystemId: player.systemId,
      targetSystemId,
      connections,
      currentFuel: player.ship.fuel,
    });

    if (!result.ok) {
      return NextResponse.json<NavigateResponse>(
        { error: result.error },
        { status: 400 },
      );
    }

    // Execute navigation in a transaction
    await prisma.$transaction(async (tx) => {
      // Update player's current system
      await tx.player.update({
        where: { id: player.id },
        data: { systemId: targetSystemId },
      });

      // Deduct fuel
      await tx.ship.update({
        where: { id: player.ship!.id },
        data: { fuel: player.ship!.fuel - result.fuelCost },
      });
    });

    // Fetch updated player state
    const updatedPlayer = await prisma.player.findUnique({
      where: { id: player.id },
      include: {
        system: true,
        ship: {
          include: {
            cargo: { include: { good: true } },
          },
        },
      },
    });

    if (!updatedPlayer || !updatedPlayer.ship) {
      return NextResponse.json<NavigateResponse>(
        { error: "Failed to fetch updated player state." },
        { status: 500 },
      );
    }

    return NextResponse.json<NavigateResponse>({
      data: {
        player: {
          id: updatedPlayer.id,
          userId: updatedPlayer.userId,
          credits: updatedPlayer.credits,
          systemId: updatedPlayer.systemId,
          system: {
            id: updatedPlayer.system.id,
            name: updatedPlayer.system.name,
            economyType: updatedPlayer.system.economyType as EconomyType,
            x: updatedPlayer.system.x,
            y: updatedPlayer.system.y,
            description: updatedPlayer.system.description,
          },
          ship: {
            id: updatedPlayer.ship.id,
            name: updatedPlayer.ship.name,
            fuel: updatedPlayer.ship.fuel,
            maxFuel: updatedPlayer.ship.maxFuel,
            cargoMax: updatedPlayer.ship.cargoMax,
            cargo: updatedPlayer.ship.cargo.map((c) => ({
              goodId: c.goodId,
              goodName: c.good.name,
              quantity: c.quantity,
            })),
          },
        },
        fuelUsed: result.fuelCost,
      },
    });
  } catch (error) {
    console.error("POST /api/game/navigate error:", error);
    return NextResponse.json<NavigateResponse>(
      { error: "Failed to navigate." },
      { status: 500 },
    );
  }
}
