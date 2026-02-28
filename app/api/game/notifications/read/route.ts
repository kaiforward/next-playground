import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSessionPlayerId } from "@/lib/auth/get-player";
import { markAsRead } from "@/lib/services/notifications";
import { parseJsonBody } from "@/lib/api/parse-json";
import type { MarkReadResponse } from "@/lib/types/api";

export async function POST(request: NextRequest) {
  try {
    const playerId = await getSessionPlayerId();
    if (!playerId) {
      return NextResponse.json<MarkReadResponse>(
        { error: "Player not found." },
        { status: 404 },
      );
    }

    const body = await parseJsonBody<{ beforeId?: string }>(request);
    const marked = await markAsRead(playerId, body?.beforeId);

    return NextResponse.json<MarkReadResponse>({ data: { marked } });
  } catch (error) {
    console.error("POST /api/game/notifications/read error:", error);
    return NextResponse.json<MarkReadResponse>(
      { error: "Failed to mark notifications as read." },
      { status: 500 },
    );
  }
}
