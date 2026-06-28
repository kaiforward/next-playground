import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requirePlayer, isErrorResponse } from "@/lib/api/require-player";
import { getSystemLogistics } from "@/lib/services/trade-flow";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import type { SystemLogisticsResponse } from "@/lib/types/api";

export function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ systemId: string }> },
) {
  return withServiceErrors(
    "GET /api/game/systems/[systemId]/logistics",
    async () => {
      const auth = await requirePlayer();
      if (isErrorResponse(auth)) return auth;

      const { systemId } = await params;
      const data = await getSystemLogistics(auth.playerId, systemId);
      return NextResponse.json<SystemLogisticsResponse>(
        { data },
        { headers: { "Cache-Control": "private, no-cache" } },
      );
    },
  );
}
