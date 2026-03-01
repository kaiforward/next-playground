import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireMutationPlayer, isErrorResponse } from "@/lib/api/require-player";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import { parseJsonBody } from "@/lib/api/parse-json";
import { addToConvoy, removeFromConvoy } from "@/lib/services/convoy";
import type { ConvoyMemberRequest, ConvoyMemberResponse } from "@/lib/types/api";

export function POST(
  request: NextRequest,
  { params }: { params: Promise<{ convoyId: string }> },
) {
  return withServiceErrors("POST /api/game/convoy/[convoyId]/members", async () => {
    const { convoyId } = await params;
    const body = await parseJsonBody<ConvoyMemberRequest>(request);
    if (!body?.shipId) {
      return NextResponse.json<ConvoyMemberResponse>({ error: "Missing shipId." }, { status: 400 });
    }

    const auth = await requireMutationPlayer();
    if (isErrorResponse(auth)) return auth;

    const result = await addToConvoy(auth.playerId, convoyId, body.shipId);
    if (!result.ok) {
      return NextResponse.json<ConvoyMemberResponse>({ error: result.error }, { status: result.status });
    }

    return NextResponse.json<ConvoyMemberResponse>({ data: result.data });
  });
}

export function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ convoyId: string }> },
) {
  return withServiceErrors("DELETE /api/game/convoy/[convoyId]/members", async () => {
    const { convoyId } = await params;
    const body = await parseJsonBody<ConvoyMemberRequest>(request);
    if (!body?.shipId) {
      return NextResponse.json<ConvoyMemberResponse>({ error: "Missing shipId." }, { status: 400 });
    }

    const auth = await requireMutationPlayer();
    if (isErrorResponse(auth)) return auth;

    const result = await removeFromConvoy(auth.playerId, convoyId, body.shipId);
    if (!result.ok) {
      return NextResponse.json<ConvoyMemberResponse>({ error: result.error }, { status: result.status });
    }

    if (result.data === null) {
      return NextResponse.json({ disbanded: true });
    }
    return NextResponse.json<ConvoyMemberResponse>({ data: result.data });
  });
}
