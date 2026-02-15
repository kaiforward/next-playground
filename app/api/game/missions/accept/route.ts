import { NextRequest, NextResponse } from "next/server";
import { getSessionPlayerId } from "@/lib/auth/get-player";
import { acceptMission } from "@/lib/services/missions";
import { parseJsonBody } from "@/lib/api/parse-json";
import { rateLimit } from "@/lib/api/rate-limit";
import { RATE_LIMIT_TIERS } from "@/lib/constants/rate-limit";
import type { AcceptMissionRequest, AcceptMissionResponse } from "@/lib/types/api";

export async function POST(request: NextRequest) {
  try {
    const playerId = await getSessionPlayerId();
    if (!playerId) {
      return NextResponse.json<AcceptMissionResponse>(
        { error: "Player not found." },
        { status: 404 },
      );
    }

    const mutationLimit = rateLimit({
      key: `mutation:${playerId}`,
      tier: RATE_LIMIT_TIERS.mutation,
    });
    if (mutationLimit) return mutationLimit;

    const body = await parseJsonBody<AcceptMissionRequest>(request);
    if (!body?.missionId) {
      return NextResponse.json<AcceptMissionResponse>(
        { error: "Missing required field: missionId." },
        { status: 400 },
      );
    }

    const result = await acceptMission(playerId, body.missionId);

    if (!result.ok) {
      return NextResponse.json<AcceptMissionResponse>(
        { error: result.error },
        { status: result.status },
      );
    }

    return NextResponse.json<AcceptMissionResponse>({ data: result.data });
  } catch (error) {
    console.error("POST /api/game/missions/accept error:", error);
    return NextResponse.json<AcceptMissionResponse>(
      { error: "Failed to accept mission." },
      { status: 500 },
    );
  }
}
