import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireMutationPlayer, isErrorResponse } from "@/lib/api/require-player";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import { parseJsonBody } from "@/lib/api/parse-json";
import { acceptMission } from "@/lib/services/missions";
import type { AcceptMissionRequest, AcceptMissionResponse } from "@/lib/types/api";

export function POST(request: NextRequest) {
  return withServiceErrors("POST /api/game/missions/accept", async () => {
    const auth = await requireMutationPlayer();
    if (isErrorResponse(auth)) return auth;

    const body = await parseJsonBody<AcceptMissionRequest>(request);
    if (!body?.missionId) {
      return NextResponse.json<AcceptMissionResponse>(
        { error: "Missing required field: missionId." },
        { status: 400 },
      );
    }

    const result = await acceptMission(auth.playerId, body.missionId);

    if (!result.ok) {
      return NextResponse.json<AcceptMissionResponse>(
        { error: result.error },
        { status: result.status },
      );
    }

    return NextResponse.json<AcceptMissionResponse>({ data: result.data });
  });
}
