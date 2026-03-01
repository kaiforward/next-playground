import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireMutationPlayer, isErrorResponse } from "@/lib/api/require-player";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import { repairShip } from "@/lib/services/repair";
import type { RepairResponse } from "@/lib/types/api";

export function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ shipId: string }> },
) {
  return withServiceErrors("POST /api/game/ship/[shipId]/repair", async () => {
    const { shipId } = await params;

    const auth = await requireMutationPlayer();
    if (isErrorResponse(auth)) return auth;

    const result = await repairShip(auth.playerId, shipId);
    if (!result.ok) {
      return NextResponse.json<RepairResponse>({ error: result.error }, { status: result.status });
    }

    return NextResponse.json<RepairResponse>({ data: result.data });
  });
}
