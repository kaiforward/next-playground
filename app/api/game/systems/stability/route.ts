import { NextResponse } from "next/server";
import { getStabilityBySystem } from "@/lib/services/stability";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import type { StabilityResponse } from "@/lib/types/api";

export function GET() {
  return withServiceErrors("GET /api/game/systems/stability", async () => {
    const systems = getStabilityBySystem();
    return NextResponse.json<StabilityResponse>(
      { data: { systems } },
      { headers: { "Cache-Control": "private, no-cache" } },
    );
  });
}
