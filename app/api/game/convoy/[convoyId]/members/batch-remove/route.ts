import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireMutationPlayer, isErrorResponse } from "@/lib/api/require-player";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import { parseJsonBody } from "@/lib/api/parse-json";
import { removeMembersFromConvoy } from "@/lib/services/convoy";
import type { ConvoyBatchMemberRequest, ConvoyMemberResponse } from "@/lib/types/api";

export function POST(
  request: NextRequest,
  { params }: { params: Promise<{ convoyId: string }> },
) {
  return withServiceErrors("POST /api/game/convoy/[convoyId]/members/batch-remove", async () => {
    const { convoyId } = await params;
    const body = await parseJsonBody<ConvoyBatchMemberRequest>(request);
    if (!body?.shipIds || !Array.isArray(body.shipIds) || body.shipIds.length === 0) {
      return NextResponse.json<ConvoyMemberResponse>({ error: "Missing or empty shipIds array." }, { status: 400 });
    }

    const auth = await requireMutationPlayer();
    if (isErrorResponse(auth)) return auth;

    const result = await removeMembersFromConvoy(auth.playerId, convoyId, body.shipIds);
    if (!result.ok) {
      return NextResponse.json<ConvoyMemberResponse>({ error: result.error }, { status: result.status });
    }

    if (result.data === null) {
      return NextResponse.json({ disbanded: true });
    }
    return NextResponse.json<ConvoyMemberResponse>({ data: result.data });
  });
}
