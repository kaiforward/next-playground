import { NextResponse } from "next/server";
import { getDynamicData } from "@/lib/services/dynamic-tiles";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import type { DynamicTileResponse } from "@/lib/types/api";

export function GET() {
  return withServiceErrors("GET /api/game/systems/dynamic", async () => {
    const data = getDynamicData();
    return NextResponse.json<DynamicTileResponse>(
      { data },
      { headers: { "Cache-Control": "private, no-cache" } },
    );
  });
}
