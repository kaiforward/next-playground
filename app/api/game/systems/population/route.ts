import { NextResponse } from "next/server";
import { getPopulationBySystem } from "@/lib/services/population-map";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import type { PopulationResponse } from "@/lib/types/api";

export function GET() {
  return withServiceErrors("GET /api/game/systems/population", async () => {
    const systems = getPopulationBySystem();
    return NextResponse.json<PopulationResponse>(
      { data: { systems } },
      { headers: { "Cache-Control": "private, no-cache" } },
    );
  });
}
