import { NextRequest, NextResponse } from "next/server";
import { getSessionPlayerId } from "@/lib/auth/get-player";
import { parseJsonBody } from "@/lib/api/parse-json";
import { executeTrade } from "@/lib/services/trade";
import type { ShipTradeRequest, ShipTradeResponse } from "@/lib/types/api";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ shipId: string }> },
) {
  try {
    const { shipId } = await params;

    const body = await parseJsonBody<ShipTradeRequest>(request);
    if (!body) {
      return NextResponse.json<ShipTradeResponse>(
        { error: "Invalid JSON body." },
        { status: 400 },
      );
    }

    const playerId = await getSessionPlayerId();
    if (!playerId) {
      return NextResponse.json<ShipTradeResponse>(
        { error: "Player not found." },
        { status: 404 },
      );
    }

    const result = await executeTrade(playerId, shipId, body);

    if (!result.ok) {
      return NextResponse.json<ShipTradeResponse>(
        { error: result.error },
        { status: result.status },
      );
    }

    return NextResponse.json<ShipTradeResponse>({ data: result.data });
  } catch (error) {
    console.error("POST /api/game/ship/[shipId]/trade error:", error);
    return NextResponse.json<ShipTradeResponse>(
      { error: "Failed to execute trade." },
      { status: 500 },
    );
  }
}
