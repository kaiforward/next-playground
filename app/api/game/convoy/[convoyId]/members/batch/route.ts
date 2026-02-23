import { NextRequest, NextResponse } from "next/server";
import { getSessionPlayerId } from "@/lib/auth/get-player";
import { parseJsonBody } from "@/lib/api/parse-json";
import { addMembersToConvoy } from "@/lib/services/convoy";
import { rateLimit } from "@/lib/api/rate-limit";
import { RATE_LIMIT_TIERS } from "@/lib/constants/rate-limit";
import type { ConvoyBatchMemberRequest, ConvoyMemberResponse } from "@/lib/types/api";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ convoyId: string }> },
) {
  try {
    const { convoyId } = await params;
    const body = await parseJsonBody<ConvoyBatchMemberRequest>(request);
    if (!body?.shipIds || !Array.isArray(body.shipIds) || body.shipIds.length === 0) {
      return NextResponse.json<ConvoyMemberResponse>({ error: "Missing or empty shipIds array." }, { status: 400 });
    }

    const playerId = await getSessionPlayerId();
    if (!playerId) {
      return NextResponse.json<ConvoyMemberResponse>({ error: "Player not found." }, { status: 404 });
    }

    const mutationLimit = rateLimit({ key: `mutation:${playerId}`, tier: RATE_LIMIT_TIERS.mutation });
    if (mutationLimit) return mutationLimit;

    const result = await addMembersToConvoy(playerId, convoyId, body.shipIds);
    if (!result.ok) {
      return NextResponse.json<ConvoyMemberResponse>({ error: result.error }, { status: result.status });
    }

    return NextResponse.json<ConvoyMemberResponse>({ data: result.data });
  } catch (error) {
    console.error("POST /api/game/convoy/[convoyId]/members/batch error:", error);
    return NextResponse.json<ConvoyMemberResponse>({ error: "Failed to add members." }, { status: 500 });
  }
}
