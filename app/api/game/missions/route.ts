import { NextRequest, NextResponse } from "next/server";
import { getSessionPlayerId } from "@/lib/auth/get-player";
import { getSystemMissions, getPlayerMissions } from "@/lib/services/missions";
import { ServiceError } from "@/lib/services/errors";
import type { SystemMissionsResponse } from "@/lib/types/api";
import type { ApiResponse, } from "@/lib/types/api";
import type { TradeMissionInfo } from "@/lib/types/game";

export async function GET(request: NextRequest) {
  try {
    const playerId = await getSessionPlayerId();
    if (!playerId) {
      return NextResponse.json<SystemMissionsResponse>(
        { error: "Player not found." },
        { status: 404 },
      );
    }

    const systemId = request.nextUrl.searchParams.get("systemId");

    if (systemId) {
      const data = await getSystemMissions(playerId, systemId);
      return NextResponse.json<SystemMissionsResponse>({ data });
    }

    // No systemId → return player's active missions only
    const missions = await getPlayerMissions(playerId);
    return NextResponse.json<ApiResponse<TradeMissionInfo[]>>({ data: missions });
  } catch (error) {
    if (error instanceof ServiceError) {
      return NextResponse.json<SystemMissionsResponse>(
        { error: error.message },
        { status: error.status },
      );
    }
    console.error("GET /api/game/missions error:", error);
    return NextResponse.json<SystemMissionsResponse>(
      { error: "Failed to fetch missions." },
      { status: 500 },
    );
  }
}
