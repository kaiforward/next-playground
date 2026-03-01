import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requirePlayer, requireMutationPlayer, isErrorResponse } from "@/lib/api/require-player";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import { parseJsonBody } from "@/lib/api/parse-json";
import { listConvoys, createConvoy } from "@/lib/services/convoy";
import type { ConvoyListResponse, CreateConvoyRequest, CreateConvoyResponse } from "@/lib/types/api";

export function GET() {
  return withServiceErrors("GET /api/game/convoy", async () => {
    const auth = await requirePlayer();
    if (isErrorResponse(auth)) return auth;

    const data = await listConvoys(auth.playerId);
    return NextResponse.json<ConvoyListResponse>({ data });
  });
}

export function POST(request: NextRequest) {
  return withServiceErrors("POST /api/game/convoy", async () => {
    const body = await parseJsonBody<CreateConvoyRequest>(request);
    if (!body) {
      return NextResponse.json<CreateConvoyResponse>({ error: "Invalid JSON body." }, { status: 400 });
    }

    const auth = await requireMutationPlayer();
    if (isErrorResponse(auth)) return auth;

    const result = await createConvoy(auth.playerId, body.shipIds, body.name);
    if (!result.ok) {
      return NextResponse.json<CreateConvoyResponse>({ error: result.error }, { status: result.status });
    }

    return NextResponse.json<CreateConvoyResponse>({ data: { convoy: result.data } }, { status: 201 });
  });
}
