import { NextResponse } from "next/server";
import { requirePlayer, isErrorResponse } from "@/lib/api/require-player";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import { getFactionDetail } from "@/lib/services/factions";
import type { FactionDetailResponse } from "@/lib/types/api";

export function GET(
  _req: Request,
  ctx: { params: Promise<{ factionId: string }> },
) {
  return withServiceErrors("GET /api/game/factions/[factionId]", async () => {
    const auth = await requirePlayer();
    if (isErrorResponse(auth)) return auth;

    const { factionId } = await ctx.params;
    const data = await getFactionDetail(factionId);
    return NextResponse.json<FactionDetailResponse>(
      { data },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  });
}
