import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireMutationPlayer, isErrorResponse } from "@/lib/api/require-player";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import { parseJsonBody } from "@/lib/api/parse-json";
import { abandonMission } from "@/lib/services/missions";
import type { AbandonMissionRequest, AbandonMissionResponse } from "@/lib/types/api";

export function POST(request: NextRequest) {
  return withServiceErrors("POST /api/game/missions/abandon", async () => {
    const auth = await requireMutationPlayer();
    if (isErrorResponse(auth)) return auth;

    const body = await parseJsonBody<AbandonMissionRequest>(request);
    if (!body?.missionId) {
      return NextResponse.json<AbandonMissionResponse>(
        { error: "Missing required field: missionId." },
        { status: 400 },
      );
    }

    const result = await abandonMission(auth.playerId, body.missionId);

    if (!result.ok) {
      return NextResponse.json<AbandonMissionResponse>(
        { error: result.error },
        { status: result.status },
      );
    }

    return NextResponse.json<AbandonMissionResponse>({ data: result.data });
  });
}
