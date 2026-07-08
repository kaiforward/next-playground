import { NextResponse } from "next/server";
import { getOwnershipBySystem } from "@/lib/services/ownership-map";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import type { OwnershipResponse } from "@/lib/types/api";

export function GET() {
  return withServiceErrors("GET /api/game/systems/ownership", async () => {
    const systems = getOwnershipBySystem();
    return NextResponse.json<OwnershipResponse>(
      { data: { systems } },
      { headers: { "Cache-Control": "private, no-cache" } },
    );
  });
}
