import { NextResponse } from "next/server";
import { requirePlayer, isErrorResponse } from "@/lib/api/require-player";
import { getAtlas } from "@/lib/services/atlas";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import type { AtlasResponse } from "@/lib/types/api";

export function GET() {
  return withServiceErrors("GET /api/game/atlas", async () => {
    const auth = await requirePlayer();
    if (isErrorResponse(auth)) return auth;

    const data = await getAtlas();
    return NextResponse.json<AtlasResponse>(
      { data },
      { headers: { "Cache-Control": "public, max-age=31536000, immutable" } },
    );
  });
}
