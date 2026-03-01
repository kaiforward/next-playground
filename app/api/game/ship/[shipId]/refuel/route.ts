import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireMutationPlayer, isErrorResponse } from "@/lib/api/require-player";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import { parseJsonBody } from "@/lib/api/parse-json";
import { executeRefuel } from "@/lib/services/refuel";
import type { ShipRefuelRequest, ShipRefuelResponse } from "@/lib/types/api";

export function POST(
  request: NextRequest,
  { params }: { params: Promise<{ shipId: string }> },
) {
  return withServiceErrors("POST /api/game/ship/[shipId]/refuel", async () => {
    const { shipId } = await params;

    const body = await parseJsonBody<ShipRefuelRequest>(request);
    if (!body) {
      return NextResponse.json<ShipRefuelResponse>(
        { error: "Invalid JSON body." },
        { status: 400 },
      );
    }

    const auth = await requireMutationPlayer();
    if (isErrorResponse(auth)) return auth;

    const result = await executeRefuel(auth.playerId, shipId, body.amount);

    if (!result.ok) {
      return NextResponse.json<ShipRefuelResponse>(
        { error: result.error },
        { status: result.status },
      );
    }

    return NextResponse.json<ShipRefuelResponse>({ data: result.data });
  });
}
