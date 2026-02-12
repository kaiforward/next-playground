import { NextRequest, NextResponse } from "next/server";
import { getSessionPlayerId } from "@/lib/auth/get-player";
import { parseJsonBody } from "@/lib/api/parse-json";
import { executeRefuel } from "@/lib/services/refuel";
import { rateLimit } from "@/lib/api/rate-limit";
import { RATE_LIMIT_TIERS } from "@/lib/constants/rate-limit";
import type { ShipRefuelRequest, ShipRefuelResponse } from "@/lib/types/api";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ shipId: string }> },
) {
  try {
    const { shipId } = await params;

    const body = await parseJsonBody<ShipRefuelRequest>(request);
    if (!body) {
      return NextResponse.json<ShipRefuelResponse>(
        { error: "Invalid JSON body." },
        { status: 400 },
      );
    }

    const playerId = await getSessionPlayerId();
    if (!playerId) {
      return NextResponse.json<ShipRefuelResponse>(
        { error: "Player not found." },
        { status: 404 },
      );
    }

    const mutationLimit = rateLimit({
      key: `mutation:${playerId}`,
      tier: RATE_LIMIT_TIERS.mutation,
    });
    if (mutationLimit) return mutationLimit;

    const result = await executeRefuel(playerId, shipId, body.amount);

    if (!result.ok) {
      return NextResponse.json<ShipRefuelResponse>(
        { error: result.error },
        { status: result.status },
      );
    }

    return NextResponse.json<ShipRefuelResponse>({ data: result.data });
  } catch (error) {
    console.error("POST /api/game/ship/[shipId]/refuel error:", error);
    return NextResponse.json<ShipRefuelResponse>(
      { error: "Failed to refuel." },
      { status: 500 },
    );
  }
}
