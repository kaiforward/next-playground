import { NextRequest, NextResponse } from "next/server";
import { getSessionPlayerId } from "@/lib/auth/get-player";
import { startMission } from "@/lib/services/missions-v2";
import { parseJsonBody } from "@/lib/api/parse-json";
import { rateLimit } from "@/lib/api/rate-limit";
import { RATE_LIMIT_TIERS } from "@/lib/constants/rate-limit";
import type { StartOpMissionRequest, StartOpMissionResponse } from "@/lib/types/api";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ missionId: string }> },
) {
  try {
    const playerId = await getSessionPlayerId();
    if (!playerId) {
      return NextResponse.json<StartOpMissionResponse>(
        { error: "Player not found." },
        { status: 404 },
      );
    }

    const mutationLimit = rateLimit({
      key: `mutation:${playerId}`,
      tier: RATE_LIMIT_TIERS.mutation,
    });
    if (mutationLimit) return mutationLimit;

    const { missionId } = await params;

    const body = await parseJsonBody<StartOpMissionRequest>(request);
    if (!body?.shipId) {
      return NextResponse.json<StartOpMissionResponse>(
        { error: "Missing required field: shipId." },
        { status: 400 },
      );
    }

    const result = await startMission(playerId, missionId, body.shipId);

    if (!result.ok) {
      return NextResponse.json<StartOpMissionResponse>(
        { error: result.error },
        { status: result.status },
      );
    }

    return NextResponse.json<StartOpMissionResponse>({ data: result.data });
  } catch (error) {
    console.error("POST /api/game/op-missions/[missionId]/start error:", error);
    return NextResponse.json<StartOpMissionResponse>(
      { error: "Failed to start mission." },
      { status: 500 },
    );
  }
}
