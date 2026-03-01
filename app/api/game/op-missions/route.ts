import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requirePlayer, isErrorResponse } from "@/lib/api/require-player";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import { getSystemAllMissions, getPlayerOpMissions } from "@/lib/services/missions-v2";
import type { SystemAllMissionsResponse, ApiResponse } from "@/lib/types/api";
import type { MissionInfo } from "@/lib/types/game";

export function GET(request: NextRequest) {
  return withServiceErrors("GET /api/game/op-missions", async () => {
    const auth = await requirePlayer();
    if (isErrorResponse(auth)) return auth;

    const systemId = request.nextUrl.searchParams.get("systemId");

    if (systemId) {
      const data = await getSystemAllMissions(auth.playerId, systemId);
      return NextResponse.json<SystemAllMissionsResponse>({ data });
    }

    const missions = await getPlayerOpMissions(auth.playerId);
    return NextResponse.json<ApiResponse<MissionInfo[]>>({ data: missions });
  });
}
