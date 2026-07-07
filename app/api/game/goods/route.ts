import { NextResponse } from "next/server";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import { getGoods } from "@/lib/services/goods";
import type { GoodsResponse } from "@/lib/types/api";

/**
 * Static catalog of all goods. Goods don't change at runtime, but their DB
 * `cuid()` ids DO change on a reseed — so we must NOT hold a long HTTP cache, or
 * the browser serves stale good ids after a reseed and any id-keyed lookup
 * (e.g. the map price overlay -> /market/by-good/[id]) 404s. `no-cache` lets the
 * browser store the response but revalidate before use, so a reseed self-heals
 * on the next load; `staleTime: Infinity` in `useGoods` still avoids in-session
 * refetches. `private` (not `public`) per convention for auth-gated routes.
 */
export function GET() {
  return withServiceErrors("GET /api/game/goods", async () => {
    const goods = getGoods();
    return NextResponse.json<GoodsResponse>(
      { data: { goods } },
      { headers: { "Cache-Control": "private, no-cache" } },
    );
  });
}
