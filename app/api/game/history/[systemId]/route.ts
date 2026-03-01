import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getTradeHistory } from "@/lib/services/market";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import type { TradeHistoryResponse } from "@/lib/types/api";

export function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ systemId: string }> },
) {
  return withServiceErrors("GET /api/game/history/[systemId]", async () => {
    const { systemId } = await params;
    const data = await getTradeHistory(systemId);
    return NextResponse.json<TradeHistoryResponse>({ data });
  });
}
