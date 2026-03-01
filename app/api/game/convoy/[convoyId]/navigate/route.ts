import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireMutationPlayer, isErrorResponse } from "@/lib/api/require-player";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import { parseJsonBody } from "@/lib/api/parse-json";
import { navigateConvoy } from "@/lib/services/convoy";
import type { ConvoyNavigateRequest, ConvoyNavigateResponse } from "@/lib/types/api";

export function POST(
  request: NextRequest,
  { params }: { params: Promise<{ convoyId: string }> },
) {
  return withServiceErrors("POST /api/game/convoy/[convoyId]/navigate", async () => {
    const { convoyId } = await params;
    const body = await parseJsonBody<ConvoyNavigateRequest>(request);
    if (!body?.route) {
      return NextResponse.json<ConvoyNavigateResponse>({ error: "Missing route." }, { status: 400 });
    }

    const auth = await requireMutationPlayer();
    if (isErrorResponse(auth)) return auth;

    const result = await navigateConvoy(auth.playerId, convoyId, body.route);
    if (!result.ok) {
      return NextResponse.json<ConvoyNavigateResponse>({ error: result.error }, { status: result.status });
    }

    return NextResponse.json<ConvoyNavigateResponse>({ data: result.data });
  });
}
