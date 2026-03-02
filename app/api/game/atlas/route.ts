import { NextResponse } from "next/server";
import { getAtlas } from "@/lib/services/atlas";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import type { AtlasResponse } from "@/lib/types/api";

export function GET() {
  return withServiceErrors("GET /api/game/atlas", async () => {
    const data = await getAtlas();
    return NextResponse.json<AtlasResponse>({ data });
  });
}
