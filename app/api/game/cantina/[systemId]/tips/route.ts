import { NextResponse } from "next/server";
import { requirePlayer, isErrorResponse } from "@/lib/api/require-player";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import { getBartenderTips } from "@/lib/services/cantina";
import type { ApiResponse } from "@/lib/types/api";
import type { BartenderData } from "@/lib/types/cantina";

export function GET(
  _request: Request,
  { params }: { params: Promise<{ systemId: string }> },
) {
  return withServiceErrors("GET /api/game/cantina/[systemId]/tips", async () => {
    const { systemId } = await params;
    const auth = await requirePlayer();
    if (isErrorResponse(auth)) return auth;

    const data = await getBartenderTips(auth.playerId, systemId);
    return NextResponse.json<ApiResponse<BartenderData>>(
      { data },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  });
}
