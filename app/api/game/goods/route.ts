import { NextResponse } from "next/server";
import { requirePlayer, isErrorResponse } from "@/lib/api/require-player";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import { getGoods } from "@/lib/services/goods";
import type { GoodsResponse } from "@/lib/types/api";

/**
 * Static catalog of all goods. Cached for the session — goods don't change
 * at runtime. `private` (not `public`) per project convention for auth-gated
 * routes; TanStack Query handles the in-memory side.
 */
export function GET() {
  return withServiceErrors("GET /api/game/goods", async () => {
    const auth = await requirePlayer();
    if (isErrorResponse(auth)) return auth;

    const goods = await getGoods();
    return NextResponse.json<GoodsResponse>(
      { data: { goods } },
      { headers: { "Cache-Control": "private, max-age=86400" } },
    );
  });
}
