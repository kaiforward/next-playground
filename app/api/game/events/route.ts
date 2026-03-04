import { NextResponse } from "next/server";
import { getActiveEvents } from "@/lib/services/events";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import { requirePlayer, isErrorResponse } from "@/lib/api/require-player";
import type { EventsResponse } from "@/lib/types/api";

export function GET() {
  return withServiceErrors("GET /api/game/events", async () => {
    const auth = await requirePlayer();
    if (isErrorResponse(auth)) return auth;

    const events = await getActiveEvents(auth.playerId);
    return NextResponse.json<EventsResponse>(
      { data: events },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  });
}
