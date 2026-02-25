import { NextRequest, NextResponse } from "next/server";
import { getSessionPlayerId } from "@/lib/auth/get-player";
import { getSystemAllMissions, getPlayerOpMissions } from "@/lib/services/missions-v2";
import { ServiceError } from "@/lib/services/errors";
import type { SystemAllMissionsResponse, ApiResponse } from "@/lib/types/api";
import type { MissionInfo } from "@/lib/types/game";

export async function GET(request: NextRequest) {
  try {
    const playerId = await getSessionPlayerId();
    if (!playerId) {
      return NextResponse.json<SystemAllMissionsResponse>(
        { error: "Player not found." },
        { status: 404 },
      );
    }

    const systemId = request.nextUrl.searchParams.get("systemId");

    if (systemId) {
      const data = await getSystemAllMissions(playerId, systemId);
      return NextResponse.json<SystemAllMissionsResponse>({ data });
    }

    // No systemId → return player's active operational missions
    const missions = await getPlayerOpMissions(playerId);
    return NextResponse.json<ApiResponse<MissionInfo[]>>({ data: missions });
  } catch (error) {
    if (error instanceof ServiceError) {
      return NextResponse.json<SystemAllMissionsResponse>(
        { error: error.message },
        { status: error.status },
      );
    }
    console.error("GET /api/game/op-missions error:", error);
    return NextResponse.json<SystemAllMissionsResponse>(
      { error: "Failed to fetch missions." },
      { status: 500 },
    );
  }
}
