import { NextResponse } from "next/server";
import { getProvisionBySystem } from "@/lib/services/provision-map";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import type { ProvisionResponse } from "@/lib/types/api";

export function GET() {
  return withServiceErrors("GET /api/game/systems/provision", async () => {
    const systems = getProvisionBySystem();
    return NextResponse.json<ProvisionResponse>(
      { data: { systems } },
      { headers: { "Cache-Control": "private, no-cache" } },
    );
  });
}
