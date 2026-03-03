import { NextResponse } from "next/server";
import { requirePlayer, isErrorResponse } from "@/lib/api/require-player";
import { getVisibleSystemIds } from "@/lib/services/visibility-cache";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import type { VisibilityResponse } from "@/lib/types/api";

export function GET() {
  return withServiceErrors("GET /api/game/systems/visibility", async () => {
    const auth = await requirePlayer();
    if (isErrorResponse(auth)) return auth;

    const systemIds = await getVisibleSystemIds(auth.playerId);
    return NextResponse.json<VisibilityResponse>(
      { data: { systemIds } },
      { headers: { "Cache-Control": "private, no-cache" } },
    );
  });
}
