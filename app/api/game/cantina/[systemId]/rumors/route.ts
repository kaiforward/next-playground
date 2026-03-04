import { NextResponse } from "next/server";
import { requirePlayer, isErrorResponse } from "@/lib/api/require-player";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import { getPatronRumors } from "@/lib/services/cantina";
import type { ApiResponse } from "@/lib/types/api";
import type { PatronData } from "@/lib/types/cantina";

export function GET(
  _request: Request,
  { params }: { params: Promise<{ systemId: string }> },
) {
  return withServiceErrors("GET /api/game/cantina/[systemId]/rumors", async () => {
    const { systemId } = await params;
    const auth = await requirePlayer();
    if (isErrorResponse(auth)) return auth;

    const data = await getPatronRumors(auth.playerId, systemId);
    return NextResponse.json<ApiResponse<PatronData>>(
      { data },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  });
}
