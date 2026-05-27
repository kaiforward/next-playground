import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requirePlayer, isErrorResponse } from "@/lib/api/require-player";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import { getMarketComparison } from "@/lib/services/market-comparison";
import type { MarketComparisonResponse } from "@/lib/types/api";

export function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ goodId: string }> },
) {
  return withServiceErrors("GET /api/game/market/by-good/[goodId]", async () => {
    const auth = await requirePlayer();
    if (isErrorResponse(auth)) return auth;

    const { goodId } = await params;
    const data = await getMarketComparison(auth.playerId, goodId);
    return NextResponse.json<MarketComparisonResponse>(
      { data },
      { headers: { "Cache-Control": "private, no-cache" } },
    );
  });
}
