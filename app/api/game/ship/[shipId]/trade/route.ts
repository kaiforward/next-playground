import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireMutationPlayer, isErrorResponse } from "@/lib/api/require-player";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import { parseJsonBody } from "@/lib/api/parse-json";
import { executeTrade } from "@/lib/services/trade";
import type { ShipTradeRequest, ShipTradeResponse } from "@/lib/types/api";

export function POST(
  request: NextRequest,
  { params }: { params: Promise<{ shipId: string }> },
) {
  return withServiceErrors("POST /api/game/ship/[shipId]/trade", async () => {
    const { shipId } = await params;

    const body = await parseJsonBody<ShipTradeRequest>(request);
    if (!body) {
      return NextResponse.json<ShipTradeResponse>(
        { error: "Invalid JSON body." },
        { status: 400 },
      );
    }

    const auth = await requireMutationPlayer();
    if (isErrorResponse(auth)) return auth;

    const result = await executeTrade(auth.playerId, shipId, body);

    if (!result.ok) {
      return NextResponse.json<ShipTradeResponse>(
        { error: result.error },
        { status: result.status },
      );
    }

    return NextResponse.json<ShipTradeResponse>({ data: result.data });
  });
}
