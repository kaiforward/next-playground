import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getMarket } from "@/lib/services/market";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import type { MarketResponse } from "@/lib/types/api";

export function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ systemId: string }> },
) {
  return withServiceErrors("GET /api/game/market/[systemId]", async () => {
    const { systemId } = await params;
    const data = await getMarket(systemId);
    return NextResponse.json<MarketResponse>({ data });
  });
}
