import { NextRequest, NextResponse } from "next/server";
import { getSessionPlayerId } from "@/lib/auth/get-player";
import { parseJsonBody } from "@/lib/api/parse-json";
import { addToConvoy, removeFromConvoy } from "@/lib/services/convoy";
import { rateLimit } from "@/lib/api/rate-limit";
import { RATE_LIMIT_TIERS } from "@/lib/constants/rate-limit";
import type { ConvoyMemberRequest, ConvoyMemberResponse } from "@/lib/types/api";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ convoyId: string }> },
) {
  try {
    const { convoyId } = await params;
    const body = await parseJsonBody<ConvoyMemberRequest>(request);
    if (!body?.shipId) {
      return NextResponse.json<ConvoyMemberResponse>({ error: "Missing shipId." }, { status: 400 });
    }

    const playerId = await getSessionPlayerId();
    if (!playerId) {
      return NextResponse.json<ConvoyMemberResponse>({ error: "Player not found." }, { status: 404 });
    }

    const mutationLimit = rateLimit({ key: `mutation:${playerId}`, tier: RATE_LIMIT_TIERS.mutation });
    if (mutationLimit) return mutationLimit;

    const result = await addToConvoy(playerId, convoyId, body.shipId);
    if (!result.ok) {
      return NextResponse.json<ConvoyMemberResponse>({ error: result.error }, { status: result.status });
    }

    return NextResponse.json<ConvoyMemberResponse>({ data: result.data });
  } catch (error) {
    console.error("POST /api/game/convoy/[convoyId]/members error:", error);
    return NextResponse.json<ConvoyMemberResponse>({ error: "Failed to add member." }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ convoyId: string }> },
) {
  try {
    const { convoyId } = await params;
    const body = await parseJsonBody<ConvoyMemberRequest>(request);
    if (!body?.shipId) {
      return NextResponse.json<ConvoyMemberResponse>({ error: "Missing shipId." }, { status: 400 });
    }

    const playerId = await getSessionPlayerId();
    if (!playerId) {
      return NextResponse.json<ConvoyMemberResponse>({ error: "Player not found." }, { status: 404 });
    }

    const mutationLimit = rateLimit({ key: `mutation:${playerId}`, tier: RATE_LIMIT_TIERS.mutation });
    if (mutationLimit) return mutationLimit;

    const result = await removeFromConvoy(playerId, convoyId, body.shipId);
    if (!result.ok) {
      return NextResponse.json<ConvoyMemberResponse>({ error: result.error }, { status: result.status });
    }

    return NextResponse.json<ConvoyMemberResponse>({ data: result.data ?? undefined });
  } catch (error) {
    console.error("DELETE /api/game/convoy/[convoyId]/members error:", error);
    return NextResponse.json<ConvoyMemberResponse>({ error: "Failed to remove member." }, { status: 500 });
  }
}
