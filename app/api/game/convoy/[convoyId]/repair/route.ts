import { NextRequest, NextResponse } from "next/server";
import { getSessionPlayerId } from "@/lib/auth/get-player";
import { parseJsonBody } from "@/lib/api/parse-json";
import { repairConvoy } from "@/lib/services/convoy-repair";
import { rateLimit } from "@/lib/api/rate-limit";
import { RATE_LIMIT_TIERS } from "@/lib/constants/rate-limit";
import type { ConvoyRepairRequest, ConvoyRepairResponse } from "@/lib/types/api";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ convoyId: string }> },
) {
  try {
    const { convoyId } = await params;
    const body = await parseJsonBody<ConvoyRepairRequest>(request);
    if (!body || typeof body.fraction !== "number") {
      return NextResponse.json<ConvoyRepairResponse>({ error: "Missing or invalid fraction." }, { status: 400 });
    }

    const playerId = await getSessionPlayerId();
    if (!playerId) {
      return NextResponse.json<ConvoyRepairResponse>({ error: "Player not found." }, { status: 404 });
    }

    const mutationLimit = rateLimit({ key: `mutation:${playerId}`, tier: RATE_LIMIT_TIERS.mutation });
    if (mutationLimit) return mutationLimit;

    const result = await repairConvoy(playerId, convoyId, body.fraction);
    if (!result.ok) {
      return NextResponse.json<ConvoyRepairResponse>({ error: result.error }, { status: result.status });
    }

    return NextResponse.json<ConvoyRepairResponse>({ data: result.data });
  } catch (error) {
    console.error("POST /api/game/convoy/[convoyId]/repair error:", error);
    return NextResponse.json<ConvoyRepairResponse>({ error: "Failed to repair convoy." }, { status: 500 });
  }
}
