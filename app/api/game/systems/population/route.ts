import { NextResponse } from "next/server";
import { requirePlayer, isErrorResponse } from "@/lib/api/require-player";
import { getPopulationBySystem } from "@/lib/services/population-map";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import type { PopulationResponse } from "@/lib/types/api";

export function GET() {
  return withServiceErrors("GET /api/game/systems/population", async () => {
    const auth = await requirePlayer();
    if (isErrorResponse(auth)) return auth;

    const systems = await getPopulationBySystem();
    return NextResponse.json<PopulationResponse>(
      { data: { systems } },
      { headers: { "Cache-Control": "private, no-cache" } },
    );
  });
}
