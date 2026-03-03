import { NextResponse } from "next/server";
import { requirePlayer, isErrorResponse } from "@/lib/api/require-player";
import { getDynamicData } from "@/lib/services/dynamic-tiles";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import type { DynamicTileResponse } from "@/lib/types/api";

export function GET() {
  return withServiceErrors("GET /api/game/systems/dynamic", async () => {
    const auth = await requirePlayer();
    if (isErrorResponse(auth)) return auth;

    const data = await getDynamicData(auth.playerId);
    return NextResponse.json<DynamicTileResponse>(
      { data },
      { headers: { "Cache-Control": "private, no-cache" } },
    );
  });
}
