import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireMutationPlayer, isErrorResponse } from "@/lib/api/require-player";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import { acceptMission } from "@/lib/services/missions-v2";
import type { AcceptOpMissionResponse } from "@/lib/types/api";

export function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ missionId: string }> },
) {
  return withServiceErrors("POST /api/game/op-missions/[missionId]/accept", async () => {
    const auth = await requireMutationPlayer();
    if (isErrorResponse(auth)) return auth;

    const { missionId } = await params;
    const result = await acceptMission(auth.playerId, missionId);

    if (!result.ok) {
      return NextResponse.json<AcceptOpMissionResponse>(
        { error: result.error },
        { status: result.status },
      );
    }

    return NextResponse.json<AcceptOpMissionResponse>({ data: result.data });
  });
}
