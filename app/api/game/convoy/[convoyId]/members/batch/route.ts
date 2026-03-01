import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireMutationPlayer, isErrorResponse } from "@/lib/api/require-player";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import { parseJsonBody } from "@/lib/api/parse-json";
import { addMembersToConvoy } from "@/lib/services/convoy";
import type { ConvoyBatchMemberRequest, ConvoyMemberResponse } from "@/lib/types/api";

export function POST(
  request: NextRequest,
  { params }: { params: Promise<{ convoyId: string }> },
) {
  return withServiceErrors("POST /api/game/convoy/[convoyId]/members/batch", async () => {
    const { convoyId } = await params;
    const body = await parseJsonBody<ConvoyBatchMemberRequest>(request);
    if (!body?.shipIds || !Array.isArray(body.shipIds) || body.shipIds.length === 0) {
      return NextResponse.json<ConvoyMemberResponse>({ error: "Missing or empty shipIds array." }, { status: 400 });
    }

    const auth = await requireMutationPlayer();
    if (isErrorResponse(auth)) return auth;

    const result = await addMembersToConvoy(auth.playerId, convoyId, body.shipIds);
    if (!result.ok) {
      return NextResponse.json<ConvoyMemberResponse>({ error: result.error }, { status: result.status });
    }

    return NextResponse.json<ConvoyMemberResponse>({ data: result.data });
  });
}
