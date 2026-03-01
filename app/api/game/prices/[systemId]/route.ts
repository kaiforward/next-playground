import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getPriceHistory } from "@/lib/services/price-history";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import type { PriceHistoryResponse } from "@/lib/types/api";

export function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ systemId: string }> },
) {
  return withServiceErrors("GET /api/game/prices/[systemId]", async () => {
    const { systemId } = await params;
    const data = await getPriceHistory(systemId);
    return NextResponse.json<PriceHistoryResponse>({ data });
  });
}
