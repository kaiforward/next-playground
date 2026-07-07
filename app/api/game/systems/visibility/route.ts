import { NextResponse } from "next/server";
import { getWorld } from "@/lib/world/store";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import type { VisibilityResponse } from "@/lib/types/api";

/**
 * All systems are visible in single-player — this returns every system id so
 * the client's dormant fog-of-war branches keep working until Phase 3
 * reactivates real visibility.
 */
export function GET() {
  return withServiceErrors("GET /api/game/systems/visibility", async () => {
    const systemIds = getWorld().systems.map((s) => s.id);
    return NextResponse.json<VisibilityResponse>(
      { data: { systemIds } },
      { headers: { "Cache-Control": "private, no-cache" } },
    );
  });
}
