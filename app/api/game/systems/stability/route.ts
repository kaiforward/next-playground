import { NextResponse } from "next/server";
import { requirePlayer, isErrorResponse } from "@/lib/api/require-player";
import { getStabilityBySystem } from "@/lib/services/stability";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import type { StabilityResponse } from "@/lib/types/api";

export function GET() {
  return withServiceErrors("GET /api/game/systems/stability", async () => {
    const auth = await requirePlayer();
    if (isErrorResponse(auth)) return auth;

    const systems = await getStabilityBySystem();
    return NextResponse.json<StabilityResponse>(
      { data: { systems } },
      { headers: { "Cache-Control": "private, no-cache" } },
    );
  });
}
