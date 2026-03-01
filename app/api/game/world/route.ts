import { NextResponse } from "next/server";
import { getGameWorld } from "@/lib/services/world";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import type { GameWorldResponse } from "@/lib/types/api";

export function GET() {
  return withServiceErrors("GET /api/game/world", async () => {
    const data = await getGameWorld();
    return NextResponse.json<GameWorldResponse>({ data });
  });
}
