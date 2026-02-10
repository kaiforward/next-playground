import { NextResponse } from "next/server";
import { getSessionPlayerId } from "@/lib/auth/get-player";
import { getFleet } from "@/lib/services/fleet";
import { ServiceError } from "@/lib/services/errors";
import type { FleetResponse } from "@/lib/types/api";

export async function GET() {
  try {
    const playerId = await getSessionPlayerId();
    if (!playerId) {
      return NextResponse.json<FleetResponse>(
        { error: "Player not found." },
        { status: 404 },
      );
    }

    const data = await getFleet(playerId);
    return NextResponse.json<FleetResponse>({ data });
  } catch (error) {
    if (error instanceof ServiceError) {
      return NextResponse.json<FleetResponse>(
        { error: error.message },
        { status: error.status },
      );
    }
    console.error("GET /api/game/fleet error:", error);
    return NextResponse.json<FleetResponse>(
      { error: "Failed to fetch fleet state." },
      { status: 500 },
    );
  }
}
