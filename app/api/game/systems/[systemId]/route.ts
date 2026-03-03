import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requirePlayer, isErrorResponse } from "@/lib/api/require-player";
import { getSystemDetail } from "@/lib/services/universe";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import type { SystemDetailResponse } from "@/lib/types/api";

export function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ systemId: string }> },
) {
  return withServiceErrors("GET /api/game/systems/[systemId]", async () => {
    const auth = await requirePlayer();
    if (isErrorResponse(auth)) return auth;

    const { systemId } = await params;
    const data = await getSystemDetail(systemId, auth.playerId);
    return NextResponse.json<SystemDetailResponse>({ data });
  });
}
