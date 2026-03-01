import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireMutationPlayer, isErrorResponse } from "@/lib/api/require-player";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import { parseJsonBody } from "@/lib/api/parse-json";
import { refuelConvoy } from "@/lib/services/convoy-refuel";
import type { ConvoyRefuelRequest, ConvoyRefuelResponse } from "@/lib/types/api";

export function POST(
  request: NextRequest,
  { params }: { params: Promise<{ convoyId: string }> },
) {
  return withServiceErrors("POST /api/game/convoy/[convoyId]/refuel", async () => {
    const { convoyId } = await params;
    const body = await parseJsonBody<ConvoyRefuelRequest>(request);
    if (!body || typeof body.fraction !== "number") {
      return NextResponse.json<ConvoyRefuelResponse>({ error: "Missing or invalid fraction." }, { status: 400 });
    }

    const auth = await requireMutationPlayer();
    if (isErrorResponse(auth)) return auth;

    const result = await refuelConvoy(auth.playerId, convoyId, body.fraction);
    if (!result.ok) {
      return NextResponse.json<ConvoyRefuelResponse>({ error: result.error }, { status: result.status });
    }

    return NextResponse.json<ConvoyRefuelResponse>({ data: result.data });
  });
}
