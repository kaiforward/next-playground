import { NextRequest, NextResponse } from "next/server";
import { getMarket } from "@/lib/services/market";
import { ServiceError } from "@/lib/services/errors";
import type { MarketResponse } from "@/lib/types/api";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ systemId: string }> },
) {
  try {
    const { systemId } = await params;
    const data = await getMarket(systemId);
    return NextResponse.json<MarketResponse>({ data });
  } catch (error) {
    if (error instanceof ServiceError) {
      return NextResponse.json<MarketResponse>(
        { error: error.message },
        { status: error.status },
      );
    }
    console.error("GET /api/game/market/[systemId] error:", error);
    return NextResponse.json<MarketResponse>(
      { error: "Failed to fetch market data." },
      { status: 500 },
    );
  }
}
