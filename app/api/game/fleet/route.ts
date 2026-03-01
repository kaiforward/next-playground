import { NextResponse } from "next/server";
import { requirePlayer, isErrorResponse } from "@/lib/api/require-player";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import { getFleet } from "@/lib/services/fleet";
import type { FleetResponse } from "@/lib/types/api";

export function GET() {
  return withServiceErrors("GET /api/game/fleet", async () => {
    const auth = await requirePlayer();
    if (isErrorResponse(auth)) return auth;

    const data = await getFleet(auth.playerId);
    return NextResponse.json<FleetResponse>({ data });
  });
}
