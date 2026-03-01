import { NextResponse } from "next/server";
import { getActiveEvents } from "@/lib/services/events";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import type { EventsResponse } from "@/lib/types/api";

export function GET() {
  return withServiceErrors("GET /api/game/events", async () => {
    const events = await getActiveEvents();
    return NextResponse.json<EventsResponse>({ data: events });
  });
}
