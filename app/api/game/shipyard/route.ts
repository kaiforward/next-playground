import { NextRequest, NextResponse } from "next/server";
import { getSessionPlayerId } from "@/lib/auth/get-player";
import { parseJsonBody } from "@/lib/api/parse-json";
import { purchaseShip } from "@/lib/services/shipyard";
import { rateLimit } from "@/lib/api/rate-limit";
import { RATE_LIMIT_TIERS } from "@/lib/constants/rate-limit";
import type { ShipPurchaseRequest, ShipPurchaseResponse } from "@/lib/types/api";

export async function POST(request: NextRequest) {
  try {
    const body = await parseJsonBody<ShipPurchaseRequest>(request);
    if (!body) {
      return NextResponse.json<ShipPurchaseResponse>(
        { error: "Invalid JSON body." },
        { status: 400 },
      );
    }

    const playerId = await getSessionPlayerId();
    if (!playerId) {
      return NextResponse.json<ShipPurchaseResponse>(
        { error: "Player not found." },
        { status: 404 },
      );
    }

    const mutationLimit = rateLimit({
      key: `mutation:${playerId}`,
      tier: RATE_LIMIT_TIERS.mutation,
    });
    if (mutationLimit) return mutationLimit;

    const result = await purchaseShip(playerId, body.systemId, body.shipType);

    if (!result.ok) {
      return NextResponse.json<ShipPurchaseResponse>(
        { error: result.error },
        { status: result.status },
      );
    }

    return NextResponse.json<ShipPurchaseResponse>({ data: result.data });
  } catch (error) {
    console.error("POST /api/game/shipyard error:", error);
    return NextResponse.json<ShipPurchaseResponse>(
      { error: "Failed to purchase ship." },
      { status: 500 },
    );
  }
}
