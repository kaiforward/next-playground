import { NextRequest, NextResponse } from "next/server";
import { getSessionPlayerId } from "@/lib/auth/get-player";
import { abandonMission } from "@/lib/services/missions-v2";
import { rateLimit } from "@/lib/api/rate-limit";
import { RATE_LIMIT_TIERS } from "@/lib/constants/rate-limit";
import type { AbandonOpMissionResponse } from "@/lib/types/api";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ missionId: string }> },
) {
  try {
    const playerId = await getSessionPlayerId();
    if (!playerId) {
      return NextResponse.json<AbandonOpMissionResponse>(
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

    const result = await abandonMission(playerId, missionId);

    if (!result.ok) {
      return NextResponse.json<AbandonOpMissionResponse>(
        { error: result.error },
        { status: result.status },
      );
    }

    return NextResponse.json<AbandonOpMissionResponse>({ data: result.data });
  } catch (error) {
    console.error("POST /api/game/op-missions/[missionId]/abandon error:", error);
    return NextResponse.json<AbandonOpMissionResponse>(
      { error: "Failed to abandon mission." },
      { status: 500 },
    );
  }
}
