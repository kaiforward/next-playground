import { NextRequest, NextResponse } from "next/server";
import { getSessionPlayerId } from "@/lib/auth/get-player";
import { parseJsonBody } from "@/lib/api/parse-json";
import { navigateConvoy } from "@/lib/services/convoy";
import { rateLimit } from "@/lib/api/rate-limit";
import { RATE_LIMIT_TIERS } from "@/lib/constants/rate-limit";
import type { ConvoyNavigateRequest, ConvoyNavigateResponse } from "@/lib/types/api";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ convoyId: string }> },
) {
  try {
    const { convoyId } = await params;
    const body = await parseJsonBody<ConvoyNavigateRequest>(request);
    if (!body?.route) {
      return NextResponse.json<ConvoyNavigateResponse>({ error: "Missing route." }, { status: 400 });
    }

    const playerId = await getSessionPlayerId();
    if (!playerId) {
      return NextResponse.json<ConvoyNavigateResponse>({ error: "Player not found." }, { status: 404 });
    }

    const mutationLimit = rateLimit({ key: `mutation:${playerId}`, tier: RATE_LIMIT_TIERS.mutation });
    if (mutationLimit) return mutationLimit;

    const result = await navigateConvoy(playerId, convoyId, body.route);
    if (!result.ok) {
      return NextResponse.json<ConvoyNavigateResponse>({ error: result.error }, { status: result.status });
    }

    return NextResponse.json<ConvoyNavigateResponse>({ data: result.data });
  } catch (error) {
    console.error("POST /api/game/convoy/[convoyId]/navigate error:", error);
    return NextResponse.json<ConvoyNavigateResponse>({ error: "Failed to navigate convoy." }, { status: 500 });
  }
}
