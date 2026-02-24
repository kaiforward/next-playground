import { NextRequest, NextResponse } from "next/server";
import { getSessionPlayerId } from "@/lib/auth/get-player";
import { getBattleDetail } from "@/lib/services/missions-v2";
import { ServiceError } from "@/lib/services/errors";
import type { BattleDetailResponse } from "@/lib/types/api";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ battleId: string }> },
) {
  try {
    const playerId = await getSessionPlayerId();
    if (!playerId) {
      return NextResponse.json<BattleDetailResponse>(
        { error: "Player not found." },
        { status: 404 },
      );
    }

    const { battleId } = await params;
    const battle = await getBattleDetail(battleId);
    return NextResponse.json<BattleDetailResponse>({ data: battle });
  } catch (error) {
    if (error instanceof ServiceError) {
      return NextResponse.json<BattleDetailResponse>(
        { error: error.message },
        { status: error.status },
      );
    }
    console.error("GET /api/game/battles/[battleId] error:", error);
    return NextResponse.json<BattleDetailResponse>(
      { error: "Failed to fetch battle." },
      { status: 500 },
    );
  }
}
