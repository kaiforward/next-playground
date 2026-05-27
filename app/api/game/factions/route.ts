import { NextResponse } from "next/server";
import { requirePlayer, isErrorResponse } from "@/lib/api/require-player";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import { listFactions } from "@/lib/services/factions";
import type { FactionListResponse } from "@/lib/types/api";

export function GET() {
  return withServiceErrors("GET /api/game/factions", async () => {
    const auth = await requirePlayer();
    if (isErrorResponse(auth)) return auth;

    const data = await listFactions();
    return NextResponse.json<FactionListResponse>(
      { data },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  });
}
