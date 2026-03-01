import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireMutationPlayer, isErrorResponse } from "@/lib/api/require-player";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import { parseJsonBody } from "@/lib/api/parse-json";
import { startMission } from "@/lib/services/missions-v2";
import type { StartOpMissionRequest, StartOpMissionResponse } from "@/lib/types/api";

export function POST(
  request: NextRequest,
  { params }: { params: Promise<{ missionId: string }> },
) {
  return withServiceErrors("POST /api/game/op-missions/[missionId]/start", async () => {
    const auth = await requireMutationPlayer();
    if (isErrorResponse(auth)) return auth;

    const { missionId } = await params;

    const body = await parseJsonBody<StartOpMissionRequest>(request);
    if (!body?.shipId) {
      return NextResponse.json<StartOpMissionResponse>(
        { error: "Missing required field: shipId." },
        { status: 400 },
      );
    }

    const result = await startMission(auth.playerId, missionId, body.shipId);

    if (!result.ok) {
      return NextResponse.json<StartOpMissionResponse>(
        { error: result.error },
        { status: result.status },
      );
    }

    return NextResponse.json<StartOpMissionResponse>({ data: result.data });
  });
}
