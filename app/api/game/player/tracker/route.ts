import { NextResponse } from "next/server";
import { getTrackerData } from "@/lib/services/tracker";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import type { TrackerResponse } from "@/lib/types/api";

export function GET() {
  return withServiceErrors("GET /api/game/player/tracker", async () => {
    const data = getTrackerData();
    return NextResponse.json<TrackerResponse>(
      { data },
      { headers: { "Cache-Control": "private, no-cache" } },
    );
  });
}
