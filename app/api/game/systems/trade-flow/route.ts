import { NextResponse } from "next/server";
import { requirePlayer, isErrorResponse } from "@/lib/api/require-player";
import { getTradeFlowEdges } from "@/lib/services/trade-flow";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import type { TradeFlowResponse } from "@/lib/types/api";

export function GET() {
  return withServiceErrors("GET /api/game/systems/trade-flow", async () => {
    const auth = await requirePlayer();
    if (isErrorResponse(auth)) return auth;

    const data = await getTradeFlowEdges(auth.playerId);
    return NextResponse.json<TradeFlowResponse>(
      { data },
      { headers: { "Cache-Control": "private, no-cache" } },
    );
  });
}
