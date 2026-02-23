import { NextRequest, NextResponse } from "next/server";
import { getSessionPlayerId } from "@/lib/auth/get-player";
import { parseJsonBody } from "@/lib/api/parse-json";
import { executeConvoyTrade } from "@/lib/services/convoy-trade";
import { rateLimit } from "@/lib/api/rate-limit";
import { RATE_LIMIT_TIERS } from "@/lib/constants/rate-limit";
import type { ShipTradeRequest, ConvoyTradeResponse } from "@/lib/types/api";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ convoyId: string }> },
) {
  try {
    const { convoyId } = await params;
    const body = await parseJsonBody<ShipTradeRequest>(request);
    if (!body?.stationId || !body?.goodId || !body?.type || !body?.quantity) {
      return NextResponse.json<ConvoyTradeResponse>(
        { error: "Missing required fields." },
        { status: 400 },
      );
    }

    const playerId = await getSessionPlayerId();
    if (!playerId) {
      return NextResponse.json<ConvoyTradeResponse>(
        { error: "Player not found." },
        { status: 404 },
      );
    }

    const mutationLimit = rateLimit({ key: `mutation:${playerId}`, tier: RATE_LIMIT_TIERS.mutation });
    if (mutationLimit) return mutationLimit;

    const result = await executeConvoyTrade(playerId, convoyId, body);
    if (!result.ok) {
      return NextResponse.json<ConvoyTradeResponse>(
        { error: result.error },
        { status: result.status },
      );
    }

    return NextResponse.json<ConvoyTradeResponse>({ data: result.data });
  } catch (error) {
    console.error("POST /api/game/convoy/[convoyId]/trade error:", error);
    return NextResponse.json<ConvoyTradeResponse>(
      { error: "Failed to execute convoy trade." },
      { status: 500 },
    );
  }
}
