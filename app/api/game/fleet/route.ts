import { NextResponse } from "next/server";
import { getSessionPlayer } from "@/lib/auth/get-player";
import { serializeShip } from "@/lib/auth/serialize";
import type { FleetResponse } from "@/lib/types/api";

/**
 * GET /api/game/fleet
 * Returns the current player's fleet state (credits + all ships).
 */
export async function GET() {
  try {
    const player = await getSessionPlayer();

    if (!player) {
      return NextResponse.json<FleetResponse>(
        { error: "Player not found." },
        { status: 404 },
      );
    }

    return NextResponse.json<FleetResponse>({
      data: {
        id: player.id,
        userId: player.userId,
        credits: player.credits,
        ships: player.ships.map(serializeShip),
      },
    });
  } catch (error) {
    console.error("GET /api/game/fleet error:", error);
    return NextResponse.json<FleetResponse>(
      { error: "Failed to fetch fleet state." },
      { status: 500 },
    );
  }
}
