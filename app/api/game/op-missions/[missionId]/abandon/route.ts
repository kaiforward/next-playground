import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireMutationPlayer, isErrorResponse } from "@/lib/api/require-player";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import { abandonMission } from "@/lib/services/missions-v2";
import type { AbandonOpMissionResponse } from "@/lib/types/api";

export function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ missionId: string }> },
) {
  return withServiceErrors("POST /api/game/op-missions/[missionId]/abandon", async () => {
    const auth = await requireMutationPlayer();
    if (isErrorResponse(auth)) return auth;

    const { missionId } = await params;
    const result = await abandonMission(auth.playerId, missionId);

    if (!result.ok) {
      return NextResponse.json<AbandonOpMissionResponse>(
        { error: result.error },
        { status: result.status },
      );
    }

    return NextResponse.json<AbandonOpMissionResponse>({ data: result.data });
  });
}
