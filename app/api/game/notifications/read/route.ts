import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireMutationPlayer, isErrorResponse } from "@/lib/api/require-player";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import { markAsRead } from "@/lib/services/notifications";
import { parseJsonBody } from "@/lib/api/parse-json";
import type { MarkReadResponse } from "@/lib/types/api";

export function POST(request: NextRequest) {
  return withServiceErrors("POST /api/game/notifications/read", async () => {
    const auth = await requireMutationPlayer();
    if (isErrorResponse(auth)) return auth;

    const body = await parseJsonBody<{ beforeId?: string }>(request);
    const marked = await markAsRead(auth.playerId, body?.beforeId);

    return NextResponse.json<MarkReadResponse>({ data: { marked } });
  });
}
