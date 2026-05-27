import { NextResponse } from "next/server";
import { requirePlayer, isErrorResponse } from "@/lib/api/require-player";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import { getRelationsMatrix } from "@/lib/services/factions";
import type { RelationsMatrixResponse } from "@/lib/types/api";

export function GET() {
  return withServiceErrors("GET /api/game/factions/relations", async () => {
    const auth = await requirePlayer();
    if (isErrorResponse(auth)) return auth;

    const data = await getRelationsMatrix();
    return NextResponse.json<RelationsMatrixResponse>(
      { data },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  });
}
