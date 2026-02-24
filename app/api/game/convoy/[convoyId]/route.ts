import { NextRequest, NextResponse } from "next/server";
import { getSessionPlayerId } from "@/lib/auth/get-player";
import { disbandConvoy } from "@/lib/services/convoy";
import { rateLimit } from "@/lib/api/rate-limit";
import { RATE_LIMIT_TIERS } from "@/lib/constants/rate-limit";
import type { ApiResponse } from "@/lib/types/api";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ convoyId: string }> },
) {
  try {
    const { convoyId } = await params;

    const playerId = await getSessionPlayerId();
    if (!playerId) {
      return NextResponse.json<ApiResponse<null>>({ error: "Player not found." }, { status: 404 });
    }

    const mutationLimit = rateLimit({ key: `mutation:${playerId}`, tier: RATE_LIMIT_TIERS.mutation });
    if (mutationLimit) return mutationLimit;

    const result = await disbandConvoy(playerId, convoyId);
    if (!result.ok) {
      return NextResponse.json<ApiResponse<null>>({ error: result.error }, { status: result.status });
    }

    return NextResponse.json<ApiResponse<{ convoyId: string }>>({ data: { convoyId } });
  } catch (error) {
    console.error("DELETE /api/game/convoy/[convoyId] error:", error);
    return NextResponse.json<ApiResponse<null>>({ error: "Failed to disband convoy." }, { status: 500 });
  }
}
