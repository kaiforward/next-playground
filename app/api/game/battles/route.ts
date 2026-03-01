import { NextResponse } from "next/server";
import { requirePlayer, isErrorResponse } from "@/lib/api/require-player";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import { getActiveBattles } from "@/lib/services/missions-v2";
import type { BattlesResponse } from "@/lib/types/api";

export function GET() {
  return withServiceErrors("GET /api/game/battles", async () => {
    const auth = await requirePlayer();
    if (isErrorResponse(auth)) return auth;

    const battles = await getActiveBattles(auth.playerId);
    return NextResponse.json<BattlesResponse>({ data: battles });
  });
}
