import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requirePlayer, isErrorResponse } from "@/lib/api/require-player";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import { getSystemMissions, getPlayerMissions } from "@/lib/services/missions";
import type { SystemMissionsResponse, ApiResponse } from "@/lib/types/api";
import type { TradeMissionInfo } from "@/lib/types/game";

export function GET(request: NextRequest) {
  return withServiceErrors("GET /api/game/missions", async () => {
    const auth = await requirePlayer();
    if (isErrorResponse(auth)) return auth;

    const systemId = request.nextUrl.searchParams.get("systemId");

    if (systemId) {
      const data = await getSystemMissions(auth.playerId, systemId);
      return NextResponse.json<SystemMissionsResponse>({ data });
    }

    const missions = await getPlayerMissions(auth.playerId);
    return NextResponse.json<ApiResponse<TradeMissionInfo[]>>({ data: missions });
  });
}
