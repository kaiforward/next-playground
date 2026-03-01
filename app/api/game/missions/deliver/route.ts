import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireMutationPlayer, isErrorResponse } from "@/lib/api/require-player";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import { parseJsonBody } from "@/lib/api/parse-json";
import { deliverMission } from "@/lib/services/missions";
import type { DeliverMissionRequest, DeliverMissionResponse } from "@/lib/types/api";

export function POST(request: NextRequest) {
  return withServiceErrors("POST /api/game/missions/deliver", async () => {
    const auth = await requireMutationPlayer();
    if (isErrorResponse(auth)) return auth;

    const body = await parseJsonBody<DeliverMissionRequest>(request);
    if (!body?.missionId || !body?.shipId) {
      return NextResponse.json<DeliverMissionResponse>(
        { error: "Missing required fields: missionId, shipId." },
        { status: 400 },
      );
    }

    const result = await deliverMission(auth.playerId, body.missionId, body.shipId);

    if (!result.ok) {
      return NextResponse.json<DeliverMissionResponse>(
        { error: result.error },
        { status: result.status },
      );
    }

    return NextResponse.json<DeliverMissionResponse>({ data: result.data });
  });
}
