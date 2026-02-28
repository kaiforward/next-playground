import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSessionPlayerId } from "@/lib/auth/get-player";
import { getNotifications } from "@/lib/services/notifications";
import type { NotificationsResponse } from "@/lib/types/api";

export async function GET(request: NextRequest) {
  try {
    const playerId = await getSessionPlayerId();
    if (!playerId) {
      return NextResponse.json<NotificationsResponse>(
        { error: "Player not found." },
        { status: 404 },
      );
    }

    const params = request.nextUrl.searchParams;
    const cursor = params.get("cursor") ?? undefined;
    const limit = params.has("limit") ? Number(params.get("limit")) : undefined;
    const types = params.getAll("types").filter(Boolean);
    const search = params.get("search") ?? undefined;
    const unreadOnly = params.get("unreadOnly") === "true";

    const result = await getNotifications(playerId, {
      cursor,
      limit,
      types: types.length > 0 ? types : undefined,
      search,
      unreadOnly,
    });

    return NextResponse.json<NotificationsResponse>({ data: result });
  } catch (error) {
    console.error("GET /api/game/notifications error:", error);
    return NextResponse.json<NotificationsResponse>(
      { error: "Failed to fetch notifications." },
      { status: 500 },
    );
  }
}
