import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import { getMarketComparison } from "@/lib/services/market-comparison";
import type { MarketComparisonResponse } from "@/lib/types/api";

export function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ goodId: string }> },
) {
  return withServiceErrors("GET /api/game/market/by-good/[goodId]", async () => {
    const { goodId } = await params;
    const data = getMarketComparison(goodId);
    return NextResponse.json<MarketComparisonResponse>(
      { data },
      { headers: { "Cache-Control": "private, no-cache" } },
    );
  });
}
