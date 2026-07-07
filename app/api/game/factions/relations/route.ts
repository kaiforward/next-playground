import { NextResponse } from "next/server";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import { getRelationsMatrix } from "@/lib/services/factions";
import type { RelationsMatrixResponse } from "@/lib/types/api";

export function GET() {
  return withServiceErrors("GET /api/game/factions/relations", async () => {
    const data = getRelationsMatrix();
    return NextResponse.json<RelationsMatrixResponse>(
      { data },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  });
}
