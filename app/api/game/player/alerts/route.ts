import { NextResponse } from "next/server";
import { getAlertData } from "@/lib/services/alerts";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import type { AlertResponse } from "@/lib/types/api";

export function GET() {
  return withServiceErrors("GET /api/game/player/alerts", async () => {
    const data = getAlertData();
    return NextResponse.json<AlertResponse>(
      { data },
      { headers: { "Cache-Control": "private, no-cache" } },
    );
  });
}
