import { NextRequest, NextResponse } from "next/server";
import { getSessionPlayerId } from "@/lib/auth/get-player";
import { repairShip } from "@/lib/services/repair";
import { rateLimit } from "@/lib/api/rate-limit";
import { RATE_LIMIT_TIERS } from "@/lib/constants/rate-limit";
import type { RepairResponse } from "@/lib/types/api";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ shipId: string }> },
) {
  try {
    const { shipId } = await params;

    const playerId = await getSessionPlayerId();
    if (!playerId) {
      return NextResponse.json<RepairResponse>({ error: "Player not found." }, { status: 404 });
    }

    const mutationLimit = rateLimit({ key: `mutation:${playerId}`, tier: RATE_LIMIT_TIERS.mutation });
    if (mutationLimit) return mutationLimit;

    const result = await repairShip(playerId, shipId);
    if (!result.ok) {
      return NextResponse.json<RepairResponse>({ error: result.error }, { status: result.status });
    }

    return NextResponse.json<RepairResponse>({ data: result.data });
  } catch (error) {
    console.error("POST /api/game/ship/[shipId]/repair error:", error);
    return NextResponse.json<RepairResponse>({ error: "Failed to repair ship." }, { status: 500 });
  }
}
