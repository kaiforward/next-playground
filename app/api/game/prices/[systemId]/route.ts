import { NextRequest, NextResponse } from "next/server";
import { getPriceHistory } from "@/lib/services/price-history";
import { ServiceError } from "@/lib/services/errors";
import type { PriceHistoryResponse } from "@/lib/types/api";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ systemId: string }> },
) {
  try {
    const { systemId } = await params;
    const data = await getPriceHistory(systemId);
    return NextResponse.json<PriceHistoryResponse>({ data });
  } catch (error) {
    if (error instanceof ServiceError) {
      return NextResponse.json<PriceHistoryResponse>(
        { error: error.message },
        { status: error.status },
      );
    }
    console.error("GET /api/game/prices/[systemId] error:", error);
    return NextResponse.json<PriceHistoryResponse>(
      { error: "Failed to fetch price history." },
      { status: 500 },
    );
  }
}
