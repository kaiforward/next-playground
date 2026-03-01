import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireMutationPlayer, isErrorResponse } from "@/lib/api/require-player";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import { parseJsonBody } from "@/lib/api/parse-json";
import { executeConvoyTrade } from "@/lib/services/convoy-trade";
import type { ShipTradeRequest, ConvoyTradeResponse } from "@/lib/types/api";

export function POST(
  request: NextRequest,
  { params }: { params: Promise<{ convoyId: string }> },
) {
  return withServiceErrors("POST /api/game/convoy/[convoyId]/trade", async () => {
    const { convoyId } = await params;
    const body = await parseJsonBody<ShipTradeRequest>(request);
    if (!body?.stationId || !body?.goodId || !body?.type || !body?.quantity) {
      return NextResponse.json<ConvoyTradeResponse>(
        { error: "Missing required fields." },
        { status: 400 },
      );
    }

    const auth = await requireMutationPlayer();
    if (isErrorResponse(auth)) return auth;

    const result = await executeConvoyTrade(auth.playerId, convoyId, body);
    if (!result.ok) {
      return NextResponse.json<ConvoyTradeResponse>(
        { error: result.error },
        { status: result.status },
      );
    }

    return NextResponse.json<ConvoyTradeResponse>({ data: result.data });
  });
}
