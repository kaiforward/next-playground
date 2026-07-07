import { NextResponse } from "next/server";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import { getFactionDetail } from "@/lib/services/factions";
import type { FactionDetailResponse } from "@/lib/types/api";

export function GET(
  _req: Request,
  ctx: { params: Promise<{ factionId: string }> },
) {
  return withServiceErrors("GET /api/game/factions/[factionId]", async () => {
    const { factionId } = await ctx.params;
    const data = getFactionDetail(factionId);
    return NextResponse.json<FactionDetailResponse>(
      { data },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  });
}
