import { NextResponse } from "next/server";
import { requirePlayer, isErrorResponse } from "@/lib/api/require-player";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import { getPlayerReputation } from "@/lib/services/reputation";
import type { ReputationResponse } from "@/lib/types/api";

export function GET() {
  return withServiceErrors("GET /api/game/reputation", async () => {
    const auth = await requirePlayer();
    if (isErrorResponse(auth)) return auth;

    const data = await getPlayerReputation(auth.playerId);
    return NextResponse.json<ReputationResponse>(
      { data },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  });
}
