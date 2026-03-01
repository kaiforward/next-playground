import { NextResponse } from "next/server";
import { requirePlayer, isErrorResponse } from "@/lib/api/require-player";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import { getUnreadCount } from "@/lib/services/notifications";
import type { UnreadCountResponse } from "@/lib/types/api";

export function GET() {
  return withServiceErrors("GET /api/game/notifications/unread", async () => {
    const auth = await requirePlayer();
    if (isErrorResponse(auth)) return auth;

    const count = await getUnreadCount(auth.playerId);
    return NextResponse.json<UnreadCountResponse>({ data: { count } });
  });
}
