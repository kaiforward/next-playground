import { NextResponse } from "next/server";
import { getSessionPlayer } from "@/lib/auth/get-player";
import type { PlayerResponse } from "@/lib/types/api";
import type { EconomyType } from "@/lib/types/game";

/**
 * GET /api/game/player
 * Returns the current player's state including ship, cargo, and system.
 */
export async function GET() {
  try {
    const player = await getSessionPlayer();

    if (!player || !player.ship) {
      return NextResponse.json<PlayerResponse>(
        { error: "Player not found." },
        { status: 404 },
      );
    }

    return NextResponse.json<PlayerResponse>({
      data: {
        id: player.id,
        userId: player.userId,
        credits: player.credits,
        systemId: player.systemId,
        system: {
          id: player.system.id,
          name: player.system.name,
          economyType: player.system.economyType as EconomyType,
          x: player.system.x,
          y: player.system.y,
          description: player.system.description,
        },
        ship: {
          id: player.ship.id,
          name: player.ship.name,
          fuel: player.ship.fuel,
          maxFuel: player.ship.maxFuel,
          cargoMax: player.ship.cargoMax,
          cargo: player.ship.cargo.map((c) => ({
            goodId: c.goodId,
            goodName: c.good.name,
            quantity: c.quantity,
          })),
        },
      },
    });
  } catch (error) {
    console.error("GET /api/game/player error:", error);
    return NextResponse.json<PlayerResponse>(
      { error: "Failed to fetch player state." },
      { status: 500 },
    );
  }
}
