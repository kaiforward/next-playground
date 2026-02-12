import { NextResponse } from "next/server";
import { getActiveEvents } from "@/lib/services/events";
import type { EventsResponse } from "@/lib/types/api";

export async function GET() {
  try {
    const events = await getActiveEvents();
    return NextResponse.json<EventsResponse>({ data: events });
  } catch (error) {
    console.error("GET /api/game/events error:", error);
    return NextResponse.json<EventsResponse>(
      { error: "Failed to fetch events." },
      { status: 500 },
    );
  }
}
