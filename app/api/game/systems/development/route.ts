import { NextResponse } from "next/server";
import { getDevelopmentBySystem } from "@/lib/services/development-map";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import type { DevelopmentResponse } from "@/lib/types/api";

export function GET() {
  return withServiceErrors("GET /api/game/systems/development", async () => {
    const systems = getDevelopmentBySystem();
    return NextResponse.json<DevelopmentResponse>(
      { data: { systems } },
      { headers: { "Cache-Control": "private, no-cache" } },
    );
  });
}
