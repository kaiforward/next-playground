import { NextRequest, NextResponse } from "next/server";
import { getTradeHistory } from "@/lib/services/market";
import { ServiceError } from "@/lib/services/errors";
import type { TradeHistoryResponse } from "@/lib/types/api";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ systemId: string }> },
) {
  try {
    const { systemId } = await params;
    const data = await getTradeHistory(systemId);
    return NextResponse.json<TradeHistoryResponse>({ data });
  } catch (error) {
    if (error instanceof ServiceError) {
      return NextResponse.json<TradeHistoryResponse>(
        { error: error.message },
        { status: error.status },
      );
    }
    console.error("GET /api/game/history/[systemId] error:", error);
    return NextResponse.json<TradeHistoryResponse>(
      { error: "Failed to fetch trade history." },
      { status: 500 },
    );
  }
}
