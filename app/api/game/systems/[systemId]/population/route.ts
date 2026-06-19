import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requirePlayer, isErrorResponse } from "@/lib/api/require-player";
import { getSystemPopulation } from "@/lib/services/system-population";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import type { SystemPopulationResponse } from "@/lib/types/api";

export function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ systemId: string }> },
) {
  return withServiceErrors(
    "GET /api/game/systems/[systemId]/population",
    async () => {
      const auth = await requirePlayer();
      if (isErrorResponse(auth)) return auth;

      const { systemId } = await params;
      const data = await getSystemPopulation(auth.playerId, systemId);
      return NextResponse.json<SystemPopulationResponse>(
        { data },
        { headers: { "Cache-Control": "private, no-cache" } },
      );
    },
  );
}
