import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireMutationPlayer, isErrorResponse } from "@/lib/api/require-player";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import { parseJsonBody } from "@/lib/api/parse-json";
import { repairConvoy } from "@/lib/services/convoy-repair";
import type { ConvoyRepairRequest, ConvoyRepairResponse } from "@/lib/types/api";

export function POST(
  request: NextRequest,
  { params }: { params: Promise<{ convoyId: string }> },
) {
  return withServiceErrors("POST /api/game/convoy/[convoyId]/repair", async () => {
    const { convoyId } = await params;
    const body = await parseJsonBody<ConvoyRepairRequest>(request);
    if (!body || typeof body.fraction !== "number") {
      return NextResponse.json<ConvoyRepairResponse>({ error: "Missing or invalid fraction." }, { status: 400 });
    }

    const auth = await requireMutationPlayer();
    if (isErrorResponse(auth)) return auth;

    const result = await repairConvoy(auth.playerId, convoyId, body.fraction);
    if (!result.ok) {
      return NextResponse.json<ConvoyRepairResponse>({ error: result.error }, { status: result.status });
    }

    return NextResponse.json<ConvoyRepairResponse>({ data: result.data });
  });
}
