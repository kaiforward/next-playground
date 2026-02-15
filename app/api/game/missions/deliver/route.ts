import { NextRequest, NextResponse } from "next/server";
import { getSessionPlayerId } from "@/lib/auth/get-player";
import { deliverMission } from "@/lib/services/missions";
import { parseJsonBody } from "@/lib/api/parse-json";
import { rateLimit } from "@/lib/api/rate-limit";
import { RATE_LIMIT_TIERS } from "@/lib/constants/rate-limit";
import type { DeliverMissionRequest, DeliverMissionResponse } from "@/lib/types/api";

export async function POST(request: NextRequest) {
  try {
    const playerId = await getSessionPlayerId();
    if (!playerId) {
      return NextResponse.json<DeliverMissionResponse>(
        { error: "Player not found." },
        { status: 404 },
      );
    }

    const mutationLimit = rateLimit({
      key: `mutation:${playerId}`,
      tier: RATE_LIMIT_TIERS.mutation,
    });
    if (mutationLimit) return mutationLimit;

    const body = await parseJsonBody<DeliverMissionRequest>(request);
    if (!body?.missionId || !body?.shipId) {
      return NextResponse.json<DeliverMissionResponse>(
        { error: "Missing required fields: missionId, shipId." },
        { status: 400 },
      );
    }

    const result = await deliverMission(playerId, body.missionId, body.shipId);

    if (!result.ok) {
      return NextResponse.json<DeliverMissionResponse>(
        { error: result.error },
        { status: result.status },
      );
    }

    return NextResponse.json<DeliverMissionResponse>({ data: result.data });
  } catch (error) {
    console.error("POST /api/game/missions/deliver error:", error);
    return NextResponse.json<DeliverMissionResponse>(
      { error: "Failed to deliver mission." },
      { status: 500 },
    );
  }
}
