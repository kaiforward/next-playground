import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireMutationPlayer, isErrorResponse } from "@/lib/api/require-player";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import { parseJsonBody } from "@/lib/api/parse-json";
import { executeNavigation } from "@/lib/services/navigation";
import type { ShipNavigateRequest, ShipNavigateResponse } from "@/lib/types/api";

export function POST(
  request: NextRequest,
  { params }: { params: Promise<{ shipId: string }> },
) {
  return withServiceErrors("POST /api/game/ship/[shipId]/navigate", async () => {
    const { shipId } = await params;

    const body = await parseJsonBody<ShipNavigateRequest>(request);
    if (!body) {
      return NextResponse.json<ShipNavigateResponse>(
        { error: "Invalid JSON body." },
        { status: 400 },
      );
    }

    const auth = await requireMutationPlayer();
    if (isErrorResponse(auth)) return auth;

    const result = await executeNavigation(auth.playerId, shipId, body.route);

    if (!result.ok) {
      return NextResponse.json<ShipNavigateResponse>(
        { error: result.error },
        { status: result.status },
      );
    }

    return NextResponse.json<ShipNavigateResponse>({ data: result.data });
  });
}
