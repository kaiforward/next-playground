import { NextResponse } from "next/server";
import { getSessionPlayerId } from "@/lib/auth/get-player";
import { getUnreadCount } from "@/lib/services/notifications";
import type { UnreadCountResponse } from "@/lib/types/api";

export async function GET() {
  try {
    const playerId = await getSessionPlayerId();
    if (!playerId) {
      return NextResponse.json<UnreadCountResponse>(
        { error: "Player not found." },
        { status: 404 },
      );
    }

    const count = await getUnreadCount(playerId);
    return NextResponse.json<UnreadCountResponse>({ data: { count } });
  } catch (error) {
    console.error("GET /api/game/notifications/unread error:", error);
    return NextResponse.json<UnreadCountResponse>(
      { error: "Failed to fetch unread count." },
      { status: 500 },
    );
  }
}
