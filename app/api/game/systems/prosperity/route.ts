import { NextResponse } from "next/server";
import { requirePlayer, isErrorResponse } from "@/lib/api/require-player";
import { getProsperityBySystem } from "@/lib/services/prosperity";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import type { ProsperityResponse } from "@/lib/types/api";

export function GET() {
  return withServiceErrors("GET /api/game/systems/prosperity", async () => {
    const auth = await requirePlayer();
    if (isErrorResponse(auth)) return auth;

    const systems = await getProsperityBySystem();
    return NextResponse.json<ProsperityResponse>(
      { data: { systems } },
      { headers: { "Cache-Control": "private, no-cache" } },
    );
  });
}
