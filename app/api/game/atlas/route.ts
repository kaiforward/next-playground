import { NextResponse } from "next/server";
import { getAtlas } from "@/lib/services/atlas";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import type { AtlasResponse } from "@/lib/types/api";

export function GET() {
  return withServiceErrors("GET /api/game/atlas", async () => {
    const data = getAtlas();
    // `no-cache` (revalidate, not a long max-age): the atlas is keyed by system
    // cuid()s, which change on a reseed. A long cache would serve stale system
    // ids that mismatch the live tile/dynamic data after a reseed. See the
    // goods route for the same reasoning.
    return NextResponse.json<AtlasResponse>(
      { data },
      { headers: { "Cache-Control": "private, no-cache" } },
    );
  });
}
