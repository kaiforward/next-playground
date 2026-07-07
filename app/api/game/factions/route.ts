import { NextResponse } from "next/server";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import { listFactions } from "@/lib/services/factions";
import type { FactionListResponse } from "@/lib/types/api";

export function GET() {
  return withServiceErrors("GET /api/game/factions", async () => {
    const data = listFactions();
    return NextResponse.json<FactionListResponse>(
      { data },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  });
}
