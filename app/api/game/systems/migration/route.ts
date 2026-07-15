import { NextResponse } from "next/server";
import { getMigrationBySystem } from "@/lib/services/migration-map";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import type { MigrationResponse } from "@/lib/types/api";

export function GET() {
  return withServiceErrors("GET /api/game/systems/migration", async () => {
    const systems = getMigrationBySystem();
    return NextResponse.json<MigrationResponse>(
      { data: { systems } },
      { headers: { "Cache-Control": "private, no-cache" } },
    );
  });
}
