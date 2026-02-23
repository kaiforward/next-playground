import { NextRequest, NextResponse } from "next/server";
import { getSessionPlayerId } from "@/lib/auth/get-player";
import { parseJsonBody } from "@/lib/api/parse-json";
import { listConvoys, createConvoy } from "@/lib/services/convoy";
import { rateLimit } from "@/lib/api/rate-limit";
import { RATE_LIMIT_TIERS } from "@/lib/constants/rate-limit";
import type { ConvoyListResponse, CreateConvoyRequest, CreateConvoyResponse } from "@/lib/types/api";

export async function GET() {
  try {
    const playerId = await getSessionPlayerId();
    if (!playerId) {
      return NextResponse.json<ConvoyListResponse>({ error: "Player not found." }, { status: 404 });
    }

    const result = await listConvoys(playerId);
    if (!result.ok) {
      return NextResponse.json<ConvoyListResponse>({ error: result.error }, { status: result.status });
    }

    return NextResponse.json<ConvoyListResponse>({ data: result.data });
  } catch (error) {
    console.error("GET /api/game/convoy error:", error);
    return NextResponse.json<ConvoyListResponse>({ error: "Failed to list convoys." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await parseJsonBody<CreateConvoyRequest>(request);
    if (!body) {
      return NextResponse.json<CreateConvoyResponse>({ error: "Invalid JSON body." }, { status: 400 });
    }

    const playerId = await getSessionPlayerId();
    if (!playerId) {
      return NextResponse.json<CreateConvoyResponse>({ error: "Player not found." }, { status: 404 });
    }

    const mutationLimit = rateLimit({ key: `mutation:${playerId}`, tier: RATE_LIMIT_TIERS.mutation });
    if (mutationLimit) return mutationLimit;

    const result = await createConvoy(playerId, body.shipIds, body.name);
    if (!result.ok) {
      return NextResponse.json<CreateConvoyResponse>({ error: result.error }, { status: result.status });
    }

    return NextResponse.json<CreateConvoyResponse>({ data: { convoy: result.data } }, { status: 201 });
  } catch (error) {
    console.error("POST /api/game/convoy error:", error);
    return NextResponse.json<CreateConvoyResponse>({ error: "Failed to create convoy." }, { status: 500 });
  }
}
