import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
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
      const { systemId } = await params;
      const data = getSystemPopulation(systemId);
      return NextResponse.json<SystemPopulationResponse>(
        { data },
        { headers: { "Cache-Control": "private, no-cache" } },
      );
    },
  );
}
