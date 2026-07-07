import { NextResponse } from "next/server";
import { getTradeFlowEdges } from "@/lib/services/trade-flow";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import type { TradeFlowResponse } from "@/lib/types/api";

export function GET() {
  return withServiceErrors("GET /api/game/systems/trade-flow", async () => {
    const data = getTradeFlowEdges();
    return NextResponse.json<TradeFlowResponse>(
      { data },
      { headers: { "Cache-Control": "private, no-cache" } },
    );
  });
}
