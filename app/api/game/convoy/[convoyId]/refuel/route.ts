import { NextRequest, NextResponse } from "next/server";
import { getSessionPlayerId } from "@/lib/auth/get-player";
import { parseJsonBody } from "@/lib/api/parse-json";
import { refuelConvoy } from "@/lib/services/convoy-refuel";
import { rateLimit } from "@/lib/api/rate-limit";
import { RATE_LIMIT_TIERS } from "@/lib/constants/rate-limit";
import type { ConvoyRefuelRequest, ConvoyRefuelResponse } from "@/lib/types/api";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ convoyId: string }> },
) {
  try {
    const { convoyId } = await params;
    const body = await parseJsonBody<ConvoyRefuelRequest>(request);
    if (!body || typeof body.fraction !== "number") {
      return NextResponse.json<ConvoyRefuelResponse>({ error: "Missing or invalid fraction." }, { status: 400 });
    }

    const playerId = await getSessionPlayerId();
    if (!playerId) {
      return NextResponse.json<ConvoyRefuelResponse>({ error: "Player not found." }, { status: 404 });
    }

    const mutationLimit = rateLimit({ key: `mutation:${playerId}`, tier: RATE_LIMIT_TIERS.mutation });
    if (mutationLimit) return mutationLimit;

    const result = await refuelConvoy(playerId, convoyId, body.fraction);
    if (!result.ok) {
      return NextResponse.json<ConvoyRefuelResponse>({ error: result.error }, { status: result.status });
    }

    return NextResponse.json<ConvoyRefuelResponse>({ data: result.data });
  } catch (error) {
    console.error("POST /api/game/convoy/[convoyId]/refuel error:", error);
    return NextResponse.json<ConvoyRefuelResponse>({ error: "Failed to refuel convoy." }, { status: 500 });
  }
}
