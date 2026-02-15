import { NextRequest, NextResponse } from "next/server";
import { getSessionPlayerId } from "@/lib/auth/get-player";
import { abandonMission } from "@/lib/services/missions";
import { parseJsonBody } from "@/lib/api/parse-json";
import type { AbandonMissionRequest, AbandonMissionResponse } from "@/lib/types/api";

export async function POST(request: NextRequest) {
  try {
    const playerId = await getSessionPlayerId();
    if (!playerId) {
      return NextResponse.json<AbandonMissionResponse>(
        { error: "Player not found." },
        { status: 404 },
      );
    }

    const body = await parseJsonBody<AbandonMissionRequest>(request);
    if (!body?.missionId) {
      return NextResponse.json<AbandonMissionResponse>(
        { error: "Missing required field: missionId." },
        { status: 400 },
      );
    }

    const result = await abandonMission(playerId, body.missionId);

    if (!result.ok) {
      return NextResponse.json<AbandonMissionResponse>(
        { error: result.error },
        { status: result.status },
      );
    }

    return NextResponse.json<AbandonMissionResponse>({ data: result.data });
  } catch (error) {
    console.error("POST /api/game/missions/abandon error:", error);
    return NextResponse.json<AbandonMissionResponse>(
      { error: "Failed to abandon mission." },
      { status: 500 },
    );
  }
}
