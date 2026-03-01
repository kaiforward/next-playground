import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requirePlayer, isErrorResponse } from "@/lib/api/require-player";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import { getBattleDetail } from "@/lib/services/missions-v2";
import type { BattleDetailResponse } from "@/lib/types/api";

export function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ battleId: string }> },
) {
  return withServiceErrors("GET /api/game/battles/[battleId]", async () => {
    const auth = await requirePlayer();
    if (isErrorResponse(auth)) return auth;

    const { battleId } = await params;
    const battle = await getBattleDetail(battleId, auth.playerId);
    return NextResponse.json<BattleDetailResponse>({ data: battle });
  });
}
