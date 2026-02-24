import { NextRequest, NextResponse } from "next/server";
import { getSessionPlayerId } from "@/lib/auth/get-player";
import { acceptMission } from "@/lib/services/missions-v2";
import { parseJsonBody } from "@/lib/api/parse-json";
import { rateLimit } from "@/lib/api/rate-limit";
import { RATE_LIMIT_TIERS } from "@/lib/constants/rate-limit";
import type { AcceptOpMissionRequest, AcceptOpMissionResponse } from "@/lib/types/api";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ missionId: string }> },
) {
  try {
    const playerId = await getSessionPlayerId();
    if (!playerId) {
      return NextResponse.json<AcceptOpMissionResponse>(
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

    const body = await parseJsonBody<AcceptOpMissionRequest>(request);
    if (!body?.shipId) {
      return NextResponse.json<AcceptOpMissionResponse>(
        { error: "Missing required field: shipId." },
        { status: 400 },
      );
    }

    const result = await acceptMission(playerId, missionId, body.shipId);

    if (!result.ok) {
      return NextResponse.json<AcceptOpMissionResponse>(
        { error: result.error },
        { status: result.status },
      );
    }

    return NextResponse.json<AcceptOpMissionResponse>({ data: result.data });
  } catch (error) {
    console.error("POST /api/game/op-missions/[missionId]/accept error:", error);
    return NextResponse.json<AcceptOpMissionResponse>(
      { error: "Failed to accept mission." },
      { status: 500 },
    );
  }
}
