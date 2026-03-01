import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requirePlayer, isErrorResponse } from "@/lib/api/require-player";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import { getNotifications } from "@/lib/services/notifications";
import type { NotificationsResponse } from "@/lib/types/api";

export function GET(request: NextRequest) {
  return withServiceErrors("GET /api/game/notifications", async () => {
    const auth = await requirePlayer();
    if (isErrorResponse(auth)) return auth;

    const searchParams = request.nextUrl.searchParams;
    const cursor = searchParams.get("cursor") ?? undefined;
    const limit = searchParams.has("limit") ? Number(searchParams.get("limit")) : undefined;
    const types = searchParams.getAll("types").filter(Boolean);
    const search = searchParams.get("search") ?? undefined;
    const unreadOnly = searchParams.get("unreadOnly") === "true";

    const result = await getNotifications(auth.playerId, {
      cursor,
      limit,
      types: types.length > 0 ? types : undefined,
      search,
      unreadOnly,
    });

    return NextResponse.json<NotificationsResponse>({ data: result });
  });
}
